#!/usr/bin/env bash
# Type-checks the native module's Kotlin without an Android SDK: compiles it
# against the Android 15 framework (Robolectric's android-all jar from Maven
# Central) plus small stubs of the Expo module API. The first EAS build is
# still the real compile; this catches mistakes earlier.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/optimus-kotlin-check"
lib="$work/lib"
mkdir -p "$lib"
M=https://repo.maven.apache.org/maven2
KV=2.1.21
jars=(
  "org/jetbrains/kotlin/kotlin-compiler-embeddable/$KV/kotlin-compiler-embeddable-$KV.jar"
  "org/jetbrains/kotlin/kotlin-stdlib/$KV/kotlin-stdlib-$KV.jar"
  "org/jetbrains/kotlin/kotlin-script-runtime/$KV/kotlin-script-runtime-$KV.jar"
  "org/jetbrains/kotlin/kotlin-reflect/1.6.10/kotlin-reflect-1.6.10.jar"
  "org/jetbrains/kotlin/kotlin-daemon-embeddable/$KV/kotlin-daemon-embeddable-$KV.jar"
  "org/jetbrains/intellij/deps/trove4j/1.0.20200330/trove4j-1.0.20200330.jar"
  "org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.8.0/kotlinx-coroutines-core-jvm-1.8.0.jar"
  "org/jetbrains/annotations/13.0/annotations-13.0.jar"
  "org/robolectric/android-all/15-robolectric-13954326/android-all-15-robolectric-13954326.jar"
)
for j in "${jars[@]}"; do
  [ -f "$lib/$(basename "$j")" ] || curl -sSfL -o "$lib/$(basename "$j")" "$M/$j"
done
compiler_cp=$(ls "$lib"/*.jar | grep -v android-all | tr '\n' ':')
rm -rf "$work/out"
java -cp "$compiler_cp" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib \
  -cp "$lib/android-all-15-robolectric-13954326.jar:$lib/kotlin-stdlib-$KV.jar" \
  -d "$work/out" -jvm-target 17 \
  "$here"/kotlin-stubs/*.kt "$here"/../modules/optimus-android/android/src/main/java/expo/modules/optimusandroid/*.kt
echo "Kotlin compiled cleanly."
