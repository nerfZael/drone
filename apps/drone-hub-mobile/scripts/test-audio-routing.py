#!/usr/bin/env python3
"""Compile the patched router against Android and run its JVM routing regressions.

Uses the Kotlin compiler cached by Gradle and the locally installed Android SDK.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

app = Path(__file__).resolve().parents[1]
repo = app.parents[1]
cache = Path(os.environ.get('GRADLE_USER_HOME', str(Path.home() / '.gradle'))) / 'caches/modules-2/files-2.1'
compilers = sorted((cache / 'org.jetbrains.kotlin/kotlin-compiler-embeddable').glob('*/*/*.jar'))
if not compilers:
    raise SystemExit('Run an Android Gradle build first to cache the Kotlin compiler.')
# Use one compiler's declared runtime versions, rather than every cached version.
compiler_jar = max(compilers, key=lambda p: tuple(int(part) for part in p.parts[-3].split('.')))
namespace = {'m': 'http://maven.apache.org/POM/4.0.0'}

def dependencies(group, artifact, version):
    directory = cache / group / artifact / version
    manifests = sorted(directory.glob('*/*.pom'))
    if not manifests:
        raise SystemExit(f'Run an Android Gradle build to cache {artifact}:{version} metadata.')
    return ET.parse(manifests[0]).findall('m:dependencies/m:dependency', namespace)

def cached_jar(group, artifact, version):
    matches = sorted((cache / group / artifact / version).glob(f'*/{artifact}-{version}.jar'))
    if not matches:
        raise SystemExit(f'Run an Android Gradle build to cache {artifact}:{version}.')
    return str(matches[0])

jars = [str(compiler_jar)]
runtime_dependencies = dependencies('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', compiler_jar.parts[-3])
for dependency in runtime_dependencies:
    group, artifact, version = (dependency.findtext(f'm:{field}', namespaces=namespace)
                                for field in ('groupId', 'artifactId', 'version'))
    jars.append(cached_jar(group, artifact, version))
    if artifact == 'kotlin-stdlib':
        for annotation in dependencies(group, artifact, version):
            if annotation.findtext('m:artifactId', namespaces=namespace) == 'annotations':
                jars.append(cached_jar(*(annotation.findtext(f'm:{field}', namespaces=namespace)
                                         for field in ('groupId', 'artifactId', 'version'))))
cp = os.pathsep.join(jars)
sdk = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', str(Path.home() / 'Android/Sdk'))))
platforms = sorted((sdk / 'platforms').glob('android-*/android.jar'), key=lambda p: int(p.parent.name.split('-')[1]))
if not platforms:
    raise SystemExit('Set ANDROID_HOME to an Android SDK with an installed platform.')
patch = (repo / 'patches/expo-audio@57.0.3.patch').read_text()
section = patch.split('+++ b/android/src/main/java/expo/modules/audio/AudioModule.kt\n', 1)[1].split('diff --git ', 1)[0]
added = [line[1:] for line in section.splitlines() if line.startswith('+')]
router_start = added.index('/** Own the communication route only while recording; media playback uses the OS route. */')
source = 'package expo.modules.audio\n\n' + '\n'.join([
    'import android.media.AudioManager',
    'import android.os.Build',
    *(line for line in added if line.startswith('import ')),
    '',
    *added[router_start:],
]) + '\n'
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
