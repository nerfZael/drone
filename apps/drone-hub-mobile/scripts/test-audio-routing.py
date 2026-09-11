#!/usr/bin/env python3
"""Compile the patched router against Android and run its JVM routing regressions.

Uses the Kotlin compiler cached by Gradle and the locally installed Android SDK.
"""
import os
from pathlib import Path
import subprocess
import tempfile

app = Path(__file__).resolve().parents[1]
repo = app.parents[1]
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
patch = (repo / 'patches/expo-audio@57.0.3.patch').read_text()
section = patch.split('+++ b/android/src/main/java/expo/modules/audio/AudioDeviceRouter.kt\n', 1)[1].split('diff --git ', 1)[0]
source = '\n'.join(line[1:] for line in section.splitlines() if line.startswith('+')) + '\n'
with tempfile.TemporaryDirectory(prefix='drone-audio-routing-') as directory:
    work = Path(directory)
    router = work / 'AudioDeviceRouter.kt'
    router.write_text(source)
    compiler = ['java', '-cp', cp, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect']
    subprocess.run([*compiler, '-classpath', cp + os.pathsep + str(platforms[-1]), '-d', str(work / 'android'), str(router)], check=True)
    subprocess.run([*compiler, '-classpath', cp, '-d', str(work / 'tests'), str(router),
                    *map(str, (app / 'tests/native-audio-routing').glob('*.kt'))], check=True)
    subprocess.run(['java', '-cp', str(work / 'tests') + os.pathsep + cp,
                    'expo.modules.audio.AudioDeviceRouterTestKt'], check=True)
