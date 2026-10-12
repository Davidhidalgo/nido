set(NIDO_INCLUDE_DIRS ".")
set(NIDO_OTA_PUBLIC_KEY "")
if(NIDO_OTA_PUBLIC_KEY_FILE)
    file(READ "${NIDO_OTA_PUBLIC_KEY_FILE}" NIDO_OTA_PUBLIC_KEY)
elseif(DEFINED ENV{NIDO_OTA_PUBLIC_KEY_FILE})
    file(READ "$ENV{NIDO_OTA_PUBLIC_KEY_FILE}" NIDO_OTA_PUBLIC_KEY)
endif()
configure_file("${CMAKE_CURRENT_LIST_DIR}/nido_ota_key.h.in" "${CMAKE_CURRENT_BINARY_DIR}/nido_ota_key.h" @ONLY)
list(APPEND NIDO_INCLUDE_DIRS "${CMAKE_CURRENT_BINARY_DIR}")
idf_component_register(
    SRCS "app_main.cc" "nido_screens.cc" "nido_device.cc" "nido_card.cc" "nido_home.cc" "nido_small_font.cc" "nido_config.cc" "nido_ota.cc" "nido_pairing.cc" "nido_github.cc"
    INCLUDE_DIRS ${NIDO_INCLUDE_DIRS}
    REQUIRES protobuf-c protocomm mdns nido_qr nido_gfx zectrix_board zectrix_epd esp_hw_support
             esp_driver_gpio esp_timer heap esp_wifi esp_event esp_netif
             esp_http_client esp_http_server app_update mbedtls nvs_flash json
)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
