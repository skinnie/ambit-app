cmake_minimum_required(VERSION 3.22.1)
project("appmodules")

set(CMAKE_CXX_STANDARD 17)

# ─── libappmodules.so (New Architecture — Codegen + Autolinking + JNI bridge) ─
#
# ReactNative-application.cmake gère tout :
#   - Définit target_compile_reactnative_options (requis par les sous-projets)
#   - find_package(ReactAndroid) + find_package(fbjni) + alias jsi/reactnative/fbjni
#   - Glob *.cpp dans ce répertoire (inclut jni_bridge.cpp) → libappmodules.so
#   - Inclut Android-autolinking.cmake et le codegen AppSpecs
#
# SoLoader.loadLibrary("appmodules") dans DefaultSoLoader.maybeLoadSoLibrary()
# charge cette bibliothèque et enregistre tous les TurboModules (DeviceInfo, etc.)
#
# Les fonctions JNI (nativeAmbitInit, etc.) sont dans libappmodules.so.
# AmbitUsbModule.kt n'a plus besoin de System.loadLibrary("ambitsync-jni").
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

# jni_bridge.cpp utilise __android_log_print → liblog
target_link_libraries(appmodules log)

# OnLoad.cpp fournit JNI_OnLoad qui initialise :
#   - DefaultTurboModuleManagerDelegate::javaModuleProvider (→ FBReactNativeSpec → DeviceInfo, etc.)
#   - DefaultTurboModuleManagerDelegate::cxxModuleProvider
#   - DefaultComponentsRegistry::registerComponentDescriptorsFromEntryPoint
# Sans lui, DeviceInfo et tous les TurboModules core sont introuvables.
target_sources(appmodules PRIVATE
    ${REACT_ANDROID_DIR}/cmake-utils/default-app-setup/OnLoad.cpp)

# ─── libambit (sources openambit copiées dans libambit/) ─────────────────────
#
# Bibliothèque statique séparée pour isoler les sources C de libambit des flags
# C++ (-std=c++20) appliqués à appmodules par ReactNative-application.cmake.
#
# hid-android.c remplace hidapi desktop (pas de libusb nécessaire).
# libambit_android.c fournit libambit_new_from_fd() pour ouvrir la montre
# via le FileDescriptor Android USB.

file(GLOB LIBAMBIT_SOURCES
    "libambit/*.c"
    "libambit/hidapi/hid-android.c"
)
add_library(ambit STATIC ${LIBAMBIT_SOURCES})
set_target_properties(ambit PROPERTIES C_STANDARD 11)
target_include_directories(ambit PUBLIC libambit libambit/hidapi)
# le16toh/le32toh sont dans <endian.h> sur Android/Bionic
# libambit desktop les obtenait via glibc; on force-include ici
target_compile_options(ambit PRIVATE -include endian.h)
target_link_libraries(appmodules ambit)
