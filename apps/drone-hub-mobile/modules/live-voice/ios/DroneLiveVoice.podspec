Pod::Spec.new do |s|
  s.name = 'DroneLiveVoice'
  s.version = '1.0.0'
  s.summary = 'Buffered Companion voice audio'
  s.description = 'Native PCM capture and playback for Companion Live voice.'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Drone'
  s.homepage = 'https://github.com/nerfZael/drone'
  s.platform = :ios, '16.4'
  s.source = { :git => 'https://github.com/nerfZael/drone.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
