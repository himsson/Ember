---
name: android-app
title: Android app
description: Make an Android phone app (APK). Checks whether Android Studio and Java are installed
---
An Android app needs Java (JDK 17) and the Android SDK to be compiled into an APK. Never say the app is ready to install if it was not compiled.

Steps:
1. check_tool java, then check_tool android-studio.
2. Create the project files anyway, with write_file, one file at a time:
   - settings.gradle.kts, build.gradle.kts (root), app/build.gradle.kts
   - app/src/main/AndroidManifest.xml
   - app/src/main/java/com/example/app/MainActivity.kt
   - app/src/main/res/layout/activity_main.xml and res/values/strings.xml
   Keep the app to one screen unless the user asked for more.
3. If both tools are installed and a gradlew file exists: run_command gradlew assembleDebug and report where the APK is.
4. If something is missing: finish the files, then ask_user. Say exactly which program is missing and offer options: "Install it for me" and "I will install it myself" (in the language of the user). Android Studio is about 1 GB to download.
5. If the user agrees to install: run_command with the winget command from the check_tool result. Then tell the user to open the project folder in Android Studio once, so it downloads the SDK.

Simple alternative to offer when the user just wants an app on the phone quickly: a web app (skill web-page) that can be added to the home screen. Mention it in one sentence, do not switch without asking.
