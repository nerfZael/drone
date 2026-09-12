import AVFoundation
import ExpoModulesCore

public class LiveVoiceModule: Module {
  private var audio: LivePcmAudio?
  private var audioId: String?
  private var controls: LiveMediaControls?

  public func definition() -> ModuleDefinition {
    Name("DroneLiveVoice")
    Events("pcmAudio", "pcmError", "mediaControl")
    AsyncFunction("armControls") { (id: String) in
      guard self.controls == nil else { throw LiveAudioError("Live headset controls are already active") }
      self.controls = LiveMediaControls(id: id) { [weak self] action in
        guard let self else { return }
        if action != "play" { self.audio?.stop(); self.audio = nil; self.audioId = nil }
        self.sendEvent("mediaControl", ["id": id, "action": action])
      }
    }.runOnQueue(.main)
    AsyncFunction("updateControls") { (id: String, state: String) in
      if self.controls?.id == id { self.controls?.update(state) }
    }.runOnQueue(.main)
    AsyncFunction("disarmControls") { (id: String) in
      if self.controls?.id == id { self.controls?.close(); self.controls = nil }
    }.runOnQueue(.main)
    AsyncFunction("playCue") { (id: String, kind: String, promise: Promise) in
      if let controls = self.controls, controls.id == id { try controls.playCue(kind, promise: promise) }
      else { promise.resolve() }
    }.runOnQueue(.main)
    AsyncFunction("startPcm") { (id: String) in
      guard self.audio == nil else { throw LiveAudioError("Live audio is already running") }
      let audio = LivePcmAudio(
        onAudio: { [weak self] data in self?.sendEvent("pcmAudio", ["id": id, "audio": data]) },
        onError: { [weak self] error in self?.sendEvent("pcmError", ["id": id, "error": error]) })
      self.audio = audio
      self.audioId = id
      do { try audio.start() }
      catch { audio.stop(); self.audio = nil; self.audioId = nil; throw error }
    }.runOnQueue(.main)
    AsyncFunction("stopPcm") { (id: String) in
      if self.audioId == id { self.audio?.stop(); self.audio = nil; self.audioId = nil }
    }.runOnQueue(.main)
    AsyncFunction("mutePcm") { (id: String, muted: Bool) in
      if self.audioId == id { self.audio?.mute(muted) }
    }.runOnQueue(.main)
    AsyncFunction("playPcm") { (id: String, data: String) in
      if self.audioId == id { try self.audio?.play(data) }
    }.runOnQueue(.main)
    OnDestroy {
      self.audio?.stop(); self.audio = nil; self.audioId = nil
      self.controls?.close(); self.controls = nil
    }
  }
}

private struct LiveAudioError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

private final class LivePcmAudio {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let lock = NSLock()
  private var stopped = false
  private var muted = false
  private var tapped = false
  private var queuedFrames = 0
  private var observer: NSObjectProtocol?
  private let onAudio: (String) -> Void
  private let onError: (String) -> Void
  private let wireFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!
  private let playFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!

  init(onAudio: @escaping (String) -> Void, onError: @escaping (String) -> Void) {
    self.onAudio = onAudio; self.onError = onError
  }
  func start() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)
    try engine.inputNode.setVoiceProcessingEnabled(true)
    let inputFormat = engine.inputNode.outputFormat(forBus: 0)
    guard let converter = AVAudioConverter(from: inputFormat, to: wireFormat) else {
      throw LiveAudioError("Could not configure the Live microphone")
    }
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: playFormat)
    engine.inputNode.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      guard let self else { return }
      self.lock.lock(); let stopped = self.stopped; let muted = self.muted; self.lock.unlock()
      if stopped { return }
      let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 24000 / inputFormat.sampleRate)) + 16
      guard let output = AVAudioPCMBuffer(pcmFormat: self.wireFormat, frameCapacity: capacity) else { return }
      var supplied = false
      var error: NSError?
      converter.convert(to: output, error: &error) { _, status in
        if supplied { status.pointee = .noDataNow; return nil }
        supplied = true; status.pointee = .haveData; return buffer
      }
      if let error { self.onError(error.localizedDescription); return }
      guard output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return }
      let data = muted ? Data(count: Int(output.frameLength) * 2)
        : Data(bytes: samples, count: Int(output.frameLength) * 2)
      self.onAudio(data.base64EncodedString())
    }
    tapped = true
    observer = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
      object: session, queue: .main) { [weak self] notification in
        if let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          type == AVAudioSession.InterruptionType.began.rawValue {
          self?.onError("Live microphone interrupted. Start a new conversation.")
          self?.stop()
        }
      }
    engine.prepare()
    try engine.start()
    player.play()
  }
  func mute(_ value: Bool) { lock.lock(); muted = value; lock.unlock() }
  func play(_ audio: String) throws {
    guard audio.count <= 256000, let data = Data(base64Encoded: audio), data.count % 2 == 0 else {
      throw LiveAudioError("Invalid Live audio")
    }
    let frames = data.count / 2
    if frames == 0 { return }
    lock.lock()
    if stopped { lock.unlock(); return }
    if queuedFrames + frames > 120000 { lock.unlock(); throw LiveAudioError("Live playback fell behind. Start again.") }
    queuedFrames += frames
    lock.unlock()
    guard let buffer = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(frames)),
      let samples = buffer.floatChannelData?[0] else { throw LiveAudioError("Could not allocate Live playback") }
    buffer.frameLength = AVAudioFrameCount(frames)
    data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
      for i in 0..<frames {
        let value = UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8
        samples[i] = Float(Int16(bitPattern: value)) / 32768
      }
    }
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self else { return }
      self.lock.lock(); self.queuedFrames = max(0, self.queuedFrames - frames); self.lock.unlock()
    }
  }
  func stop() {
    lock.lock()
    if stopped { lock.unlock(); return }
    stopped = true; muted = true
    lock.unlock()
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
    player.stop(); engine.stop()
  }
}
