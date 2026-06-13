import java.io.File
import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

data class AndroidVersion(val code: Int, val nameBase: String)

fun loadAndroidVersion(versionFile: File, rootDir: File): AndroidVersion {
    val existing = parseVersionProperties(versionFile)
    val currentHash = androidInputHash(rootDir)
    val previousHash = existing["androidInputHash"].orEmpty()
    val currentCode = existing["versionCode"]?.toIntOrNull() ?: 1
    val nameBase = existing["versionNameBase"] ?: "0.3"
    val nextCode = if (previousHash.isNotBlank() && previousHash != currentHash) currentCode + 1 else currentCode

    if (previousHash != currentHash || existing["versionCode"] != nextCode.toString() || existing["versionNameBase"] != nameBase) {
        versionFile.parentFile.mkdirs()
        versionFile.writeText(
            listOf(
                "versionCode=$nextCode",
                "versionNameBase=$nameBase",
                "androidInputHash=$currentHash",
                "",
            ).joinToString("\n")
        )
    }

    return AndroidVersion(nextCode, nameBase)
}

fun parseVersionProperties(versionFile: File): Map<String, String> {
    if (!versionFile.exists()) return emptyMap()
    return versionFile.readLines()
        .map { it.trim() }
        .filter { it.isNotBlank() && !it.startsWith("#") }
        .mapNotNull { line ->
            val separator = line.indexOf("=")
            if (separator <= 0) null else line.substring(0, separator).trim() to line.substring(separator + 1).trim()
        }
        .toMap()
}

fun androidInputHash(rootDir: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val inputs = listOf(
        File(rootDir, "android/app/build.gradle.kts"),
        File(rootDir, "android/app/src"),
        File(rootDir, "build.gradle.kts"),
        File(rootDir, "settings.gradle.kts"),
        File(rootDir, "gradle.properties"),
        File(rootDir, "gradle"),
        File(rootDir, "gradlew"),
        File(rootDir, "gradlew.bat"),
    )
        .flatMap { input ->
            when {
                input.isFile -> listOf(input)
                input.isDirectory -> input.walkTopDown().filter { it.isFile }.toList()
                else -> emptyList()
            }
        }
        .sortedBy { it.relativeTo(rootDir).invariantSeparatorsPath }

    for (file in inputs) {
        val relativePath = file.relativeTo(rootDir).invariantSeparatorsPath
        digest.update(relativePath.toByteArray(Charsets.UTF_8))
        digest.update(0)
        digest.update(file.readBytes())
        digest.update(0)
    }

    return digest.digest().joinToString("") { "%02x".format(it) }
}

val androidVersion = loadAndroidVersion(rootProject.file("android/version.properties"), rootDir)

android {
    namespace = "com.example.voicestream"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.example.voicestream"
        minSdk = 26
        targetSdk = 35
        versionCode = androidVersion.code
        versionName = "${androidVersion.nameBase}.${androidVersion.code}"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.alphacephei:vosk-android:0.3.47")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
}
