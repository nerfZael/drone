#!/usr/bin/env python3
"""Compile Live PCM against Android and run its JVM playback regressions.

Uses the Kotlin compiler cached by Gradle and the locally installed Android SDK.
"""
import os
from pathlib import Path
import subprocess
import tempfile

app = Path(__file__).resolve().parents[1]
cache = Path(os.environ.get('GRADLE_USER_HOME', str(Path.home() / '.gradle'))) / 'caches/modules-2/files-2.1'
artifacts = {'kotlin-compiler-embeddable', 'kotlin-stdlib', 'kotlin-script-runtime',
             'kotlin-reflect', 'kotlin-daemon-embeddable', 'kotlinx-coroutines-core-jvm',
             'trove4j', 'annotations'}
jars = [str(p) for p in cache.rglob('*.jar') if p.parts[-4] in artifacts]
if not any('kotlin-compiler-embeddable' in p for p in jars):
    raise SystemExit('Run an Android Gradle build first to cache the Kotlin compiler.')
cp = os.pathsep.join(jars)
sdk = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', str(Path.home() / 'Android/Sdk'))))
platforms = sorted((sdk / 'platforms').glob('android-*/android.jar'), key=lambda p: int(p.parent.name.split('-')[1]))
if not platforms:
    raise SystemExit('Set ANDROID_HOME to an Android SDK with an installed platform.')
source = app / 'modules/live-voice/android/src/main/java/expo/modules/dronelivevoice/LivePcmAudio.kt'
with tempfile.TemporaryDirectory(prefix='drone-live-playback-') as directory:
    work = Path(directory)
    compiler = ['java', '-cp', cp, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect']
    subprocess.run([*compiler, '-classpath', cp + os.pathsep + str(platforms[-1]), '-d', str(work / 'android'), str(source)], check=True)
    subprocess.run([*compiler, '-classpath', cp, '-d', str(work / 'tests'), str(source), str(source.with_name('LiveMediaControls.kt')), str(source.with_name('LiveBluetoothRoute.kt')),
                    *map(str, (app / 'tests/native-live-playback').glob('*.kt'))], check=True)
    subprocess.run(['java', '-cp', str(work / 'tests') + os.pathsep + cp,
                    'expo.modules.dronelivevoice.LivePlaybackTestKt'], check=True)
    subprocess.run(['java', '-cp', str(work / 'tests') + os.pathsep + cp,
                    'expo.modules.dronelivevoice.LiveMediaControlsTestKt'], check=True)
    subprocess.run(['java', '-cp', str(work / 'tests') + os.pathsep + cp,
                    'expo.modules.dronelivevoice.LiveBluetoothRouteTestKt'], check=True)
