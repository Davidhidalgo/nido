#pragma once
#include "esp_ota_ops.h"
constexpr int ESP_FAIL=-1;
constexpr int HTTP_EVENT_ON_HEADER=1;
struct esp_http_client_event_t {int event_id;const char* header_key;const char* header_value;void* user_data;};
struct esp_http_client_config_t {const char* url;int (*crt_bundle_attach)(void*);int timeout_ms;bool disable_auto_redirect;esp_err_t (*event_handler)(esp_http_client_event_t*);void* user_data;int buffer_size;int buffer_size_tx;};
struct FakeHttp;
using esp_http_client_handle_t=FakeHttp*;
esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t*);
int esp_http_client_close(esp_http_client_handle_t);
int esp_http_client_cleanup(esp_http_client_handle_t);
int esp_http_client_set_header(esp_http_client_handle_t,const char*,const char*);
int esp_http_client_open(esp_http_client_handle_t,int);
int esp_http_client_set_timeout_ms(esp_http_client_handle_t,int);
int64_t esp_http_client_fetch_headers(esp_http_client_handle_t);
int esp_http_client_get_status_code(esp_http_client_handle_t);
int esp_http_client_read(esp_http_client_handle_t,char*,int);
bool esp_http_client_is_complete_data_received(esp_http_client_handle_t);
