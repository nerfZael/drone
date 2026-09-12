import AVFoundation
import MediaPlayer
import UIKit
import ExpoModulesCore

final class LiveMediaControls: NSObject, AVAudioPlayerDelegate {
  let id: String
  private var playing = true
  private var closed = false
  private var targets: [(MPRemoteCommand, Any)] = []
  private var cue: AVAudioPlayer?
  private var cuePromise: Promise?
  private var deactivateAfterCue = false
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private let onAction: (String) -> Void

  init(id: String, onAction: @escaping (String) -> Void) {
    self.id = id; self.onAction = onAction
    super.init()
    let center = MPRemoteCommandCenter.shared()
    register(center.playCommand, action: "play")
    register(center.pauseCommand, action: "pause")
    register(center.stopCommand, action: "stop")
    register(center.togglePlayPauseCommand, action: "toggle")
    update("connecting")
  }

  private func register(_ command: MPRemoteCommand, action: String) {
    command.isEnabled = true
    let target = command.addTarget { [weak self] _ in
      DispatchQueue.main.async { self?.command(action) }
      return .success
    }
    targets.append((command, target))
  }

  private func command(_ requested: String) {
    if closed { return }
    let action = requested == "toggle" ? (playing ? "pause" : "play") : requested
    if action == "play" && playing || action == "pause" && !playing { return }
    // Allow JS to deliver session.close after stopping background microphone audio.
    if backgroundTask == .invalid {
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Live media command") { [weak self] in self?.endBackgroundTask() }
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.endBackgroundTask() }
    }
    update(action == "play" ? "connecting" : "paused")
    onAction(action)
  }

  func update(_ state: String) {
    if closed { return }
    playing = state != "paused"
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: "Live Companion",
      MPMediaItemPropertyArtist: playing ? "Listening" : "Paused · Microphone off",
      MPNowPlayingInfoPropertyIsLiveStream: true,
      MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0
    ]
    MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
  }

  func playCue(_ kind: String, promise: Promise) throws {
    if closed { promise.resolve(); return }
    cue?.stop(); cuePromise?.resolve(); cuePromise = nil
    deactivateAfterCue = kind == "stopped"
    let rate = 24000
    let count = rate / 5
    var pcm = Data()
    for i in 0..<count {
      let half = i < count / 2
      let hz = kind == "recording" ? (half ? 600.0 : 900.0) : (half ? 900.0 : 500.0)
      let phase = Double(i % (count / 2)) / Double(count / 2)
      let envelope = min(1, min(phase * 20, (1 - phase) * 20))
      var sample = Int16(sin(Double(i) * 2 * .pi * hz / Double(rate)) * 6500 * envelope).littleEndian
      withUnsafeBytes(of: &sample) { pcm.append(contentsOf: $0) }
    }
    var wav = Data("RIFF".utf8)
    func append<T: FixedWidthInteger>(_ value: T) {
      var little = value.littleEndian
      withUnsafeBytes(of: &little) { wav.append(contentsOf: $0) }
    }
    append(UInt32(36 + pcm.count)); wav.append(Data("WAVEfmt ".utf8))
    append(UInt32(16)); append(UInt16(1)); append(UInt16(1)); append(UInt32(rate))
    append(UInt32(rate * 2)); append(UInt16(2)); append(UInt16(16))
    wav.append(Data("data".utf8)); append(UInt32(pcm.count)); wav.append(pcm)
    let session = AVAudioSession.sharedInstance()
    var started = false
    defer {
      if !started && deactivateAfterCue {
        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
        deactivateAfterCue = false
      }
    }
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)
    let player = try AVAudioPlayer(data: wav)
    player.delegate = self
    guard player.play() else { throw NSError(domain: "DroneLiveVoice", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not play Live audio cue"]) }
    cue = player; cuePromise = promise
    started = true
    // Interruptions can suppress AVAudioPlayer's completion delegate.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self, weak player] in
      guard let self, let player, player === self.cue else { return }
      self.finishCue()
    }
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    if player === cue { finishCue() }
  }
  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    if player === cue { finishCue() }
  }
  private func finishCue() {
    cue?.stop(); cue = nil
    if deactivateAfterCue { try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation]) }
    deactivateAfterCue = false
    cuePromise?.resolve(); cuePromise = nil
  }
  private func endBackgroundTask() {
    if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid }
  }
  func close() {
    if closed { return }
    closed = true
    for (command, target) in targets { command.removeTarget(target); command.isEnabled = false }
    targets.removeAll()
    cue?.stop(); cue = nil; cuePromise?.resolve(); cuePromise = nil
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    MPNowPlayingInfoCenter.default().playbackState = .stopped
    endBackgroundTask()
  }
}
