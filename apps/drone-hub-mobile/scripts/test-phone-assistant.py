#!/usr/bin/env python3
"""Run the native assistant request lifecycle tests using the cached Kotlin compiler."""
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
source = app / 'modules/live-voice/android/src/main/java/expo/modules/dronelivevoice/CompanionAssistantRequest.kt'
with tempfile.TemporaryDirectory(prefix='drone-phone-assistant-') as directory:
    subprocess.run(['java', '-cp', cp, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
                    '-no-stdlib', '-no-reflect', '-classpath', cp, '-d', directory, str(source),
                    str(source.with_name('CompanionAssistantSettings.kt')),
                    *map(str, (app / 'tests/native-phone-assistant').glob('*.kt'))], check=True)
    subprocess.run(['java', '-cp', directory + os.pathsep + cp,
                    'expo.modules.dronelivevoice.CompanionAssistantRequestTestKt'], check=True)
