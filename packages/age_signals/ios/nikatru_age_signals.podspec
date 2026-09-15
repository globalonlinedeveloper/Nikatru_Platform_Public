# [ADR 082] §5 — the Apple Declared Age Range adapter. The app builds with Swift
# Package Manager (ios/nikatru_age_signals/Package.swift); this podspec keeps the
# plugin buildable for a CocoaPods consumer too.
Pod::Spec.new do |s|
  s.name             = 'nikatru_age_signals'
  s.version          = '0.1.0'
  s.summary          = 'Store age-signal adapter for the NIKATRU sign-up age gate.'
  s.description      = 'Reads Apple Declared Age Range for the sign-up age gate only.'
  s.homepage         = 'https://github.com/globalonlinedeveloper/Nikatru_Platform_Public'
  s.license          = { :type => 'Proprietary' }
  s.author           = { 'NIKATRU' => 'support@nikatru.com' }
  s.source           = { :path => '.' }
  s.source_files     = 'nikatru_age_signals/Sources/nikatru_age_signals/**/*.swift'
  s.dependency 'Flutter'
  s.platform         = :ios, '13.0'
  s.swift_version    = '5.9'
end
