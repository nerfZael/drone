import java.time.Instant

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val androidVersionCode = 23
val androidVersionName = "0.1.23"
val configuredAndroidServerUrl = System.getenv("VOICE_STREAM_NEXT_ANDROID_SERVER_URL")
    ?.takeIf { it.isNotBlank() }
    ?: System.getenv("VOICE_STREAM_NEXT_SERVER_URL")?.takeIf { it.isNotBlank() }
val debugAndroidServerUrl = configuredAndroidServerUrl ?: "http://10.0.2.2:3299"
val releaseAndroidServerUrl = configuredAndroidServerUrl ?: "https://voice-stream-next-production.up.railway.app"

android {
    namespace = "com.huntelkator.voicestreamnext"
    compileSdk = 36
    val releaseKeystorePath = System.getenv("VOICE_STREAM_NEXT_ANDROID_KEYSTORE").orEmpty()
    val releaseKeyAlias = System.getenv("VOICE_STREAM_NEXT_ANDROID_KEY_ALIAS").orEmpty()
    val releaseKeyPassword = System.getenv("VOICE_STREAM_NEXT_ANDROID_KEY_PASSWORD").orEmpty()
    val releaseStorePassword = System.getenv("VOICE_STREAM_NEXT_ANDROID_STORE_PASSWORD").orEmpty()

    defaultConfig {
        applicationId = "com.huntelkator.voicestreamnext"
        minSdk = 26
        targetSdk = 35
        versionCode = androidVersionCode
        versionName = androidVersionName
        buildConfigField("String", "CLERK_PUBLISHABLE_KEY", "\"${System.getenv("VOICE_STREAM_NEXT_ANDROID_CLERK_PUBLISHABLE_KEY").orEmpty()}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        getByName("debug") {
            buildConfigField("String", "DEFAULT_SERVER_URL", jsonString(debugAndroidServerUrl))
        }
        getByName("release") {
            buildConfigField("String", "DEFAULT_SERVER_URL", jsonString(releaseAndroidServerUrl))
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir("../../../voice-stream/android/app/src/main/assets")
        }
    }

    if (releaseKeystorePath.isNotBlank() && releaseKeyAlias.isNotBlank() && releaseKeyPassword.isNotBlank() && releaseStorePassword.isNotBlank()) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseKeystorePath)
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                storePassword = releaseStorePassword
            }
        }
        buildTypes.getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    packaging {
        resources {
            excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        }
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
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.clerk:clerk-android-api:1.0.13")
    implementation("com.alphacephei:vosk-android:0.3.47")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
}

fun jsonString(value: String): String =
    buildString {
        append('"')
        value.forEach { char ->
            when (char) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(char)
            }
        }
        append('"')
    }

fun voiceStreamDataDir(): File {
    val configured = System.getenv("VOICE_STREAM_NEXT_DATA_DIR")?.trim().orEmpty()
    return if (configured.isNotBlank()) file(configured) else file("../../server/data")
}

fun publishAndroidApk(variantName: String, apkFile: File) {
    if (!apkFile.exists()) {
        throw GradleException("Android APK was not found at ${apkFile.absolutePath}")
    }
    val outputDir = voiceStreamDataDir().resolve("mobile/Android")
    val variantFileName = "voice-stream-next-android-$variantName.apk"
    val latestFileName = "voice-stream-next-android-latest.apk"
    outputDir.mkdirs()
    copy {
        from(apkFile)
        into(outputDir)
        rename { variantFileName }
    }
    copy {
        from(apkFile)
        into(outputDir)
        rename { latestFileName }
    }
    val latestFile = outputDir.resolve(latestFileName)
    val metadata = """
        {
          "app": "voice-stream-next",
          "platform": "android",
          "variant": ${jsonString(variantName)},
          "versionCode": $androidVersionCode,
          "versionName": ${jsonString(androidVersionName)},
          "fileName": ${jsonString(latestFileName)},
          "variantFileName": ${jsonString(variantFileName)},
          "size": ${latestFile.length()},
          "builtAt": ${jsonString(Instant.now().toString())}
        }
    """.trimIndent()
    outputDir.resolve("latest.json").writeText(metadata)
    logger.lifecycle("Published VoiceStream Android APK to ${latestFile.absolutePath}")
}

tasks.configureEach {
    if (name == "assembleDebug") {
        doLast {
            publishAndroidApk("debug", layout.buildDirectory.file("outputs/apk/debug/app-debug.apk").get().asFile)
        }
    }
    if (name == "assembleRelease") {
        doLast {
            val releaseDir = layout.buildDirectory.dir("outputs/apk/release").get().asFile
            val apkFile = listOf("app-release.apk", "app-release-unsigned.apk")
                .map { releaseDir.resolve(it) }
                .firstOrNull { it.exists() }
                ?: throw GradleException("Android release APK was not found in ${releaseDir.absolutePath}")
            publishAndroidApk("release", apkFile)
        }
    }
}
