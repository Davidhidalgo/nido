# Software de terceros

`components/zectrix_board`, `components/zectrix_epd` y `components/nido_gfx` fueron copiados de [Hearth](https://github.com/shantanugoel/hearth), commit `edd75fd7ea7e9879b141a84aa39ce2c74b6c92bc`, MIT, copyright 2026 Shantanu Goel. La licencia está en `licenses/HEARTH_MIT_LICENSE`.

Los drivers y el canvas proceden de [zectrix-note4-epd-demo](https://github.com/itopinion/zectrix-note4-epd-demo), MIT, copyright 2026 Zectrix Lab. La licencia está en `licenses/ZECTRIX_MIT_LICENSE`; los archivos `ORIGIN.md` conservan la procedencia y cambios previos de Hearth.

El bitmap ASCII se rasterizó de TRMNL16 Regular de Heavyweight Digital Type Foundry, SIL Open Font License 1.1. Se conserva `licenses/TRMNL_FONT_LICENSE.txt`. Nido añade marcas para caracteres españoles, puntos suspensivos y decodificación UTF-8 al dibujarlo.

Cambios de Nido a los componentes copiados: inicio opcional del sampler de botones, restauración y apagado de GPIO, amplificador desactivado al arrancar audio, cuenta atrás RTC con interrupción mantenida, apagado de CLKOUT y caracteres españoles y puntos suspensivos en el canvas. El muestreador de botones heredado no se inicia en la aplicación de prueba.

ESP-IDF y `espressif/esp_codec_dev` son dependencias externas obtenidas de Espressif y conservan sus licencias. SDK y herramientas quedan fuera de Git; Component Manager entrega la licencia de audio en `managed_components/espressif__esp_codec_dev/LICENSE`.

## Nayuki QR Code generator

`components/nido_qr/` incorpora sin modificaciones la implementación C de Nayuki v1.8.0, bajo licencia MIT. El copyright y el texto completo de la licencia se conservan en `qrcodegen.c` y `include/qrcodegen.h`. Origen: https://github.com/nayuki/QR-Code-generator/tree/v1.8.0/c

## Espressif mDNS y protocomm

El manifiesto `main/idf_component.yml` fija `espressif/mdns` 1.8.2 (Apache-2.0), descargado por el gestor de componentes; su licencia se conserva en el componente administrado. La vinculación usa `protocomm_security2` y SRP de ESP-IDF v5.4.2 (Apache-2.0). Las pruebas host compilan el código del SDK instalado sin copiarlo al repositorio.
