# Documentación del proyecto vencimientos-app

Aplicación móvil para fotografiar la fecha impresa en un producto, reconocerla en el dispositivo y guardarla en una lista local ordenada por vencimiento.

Plataforma: Expo SDK 58, React Native 0.88 y TypeScript. Identificador Android: `com.ferdev2.vencimientosapp`.

## Qué hace el aplicativo

El usuario abre una sola pantalla, **Vencimientos**. Desde ahí puede:

1. Tomar una foto de la fecha impresa en el empaque.
2. Revisar la fecha que la app leyó y escribir el nombre del producto.
3. Guardar el registro en el teléfono.
4. Ver la lista ordenada por fecha, con el estado (vence hoy, vence en N días o ya venció).
5. Eliminar un registro.

La lectura ocurre en el celular. La foto no se envía a un servidor. La lista queda en una base SQLite del teléfono, en el archivo `vencimientos.db`.

## Requisitos y cómo se cumplen

| Requisito | Cómo se cumple | Dónde está |
|---|---|---|
| Capturar la fecha con la cámara | El botón **Tomar foto** abre la cámara del sistema y devuelve la imagen | `src/app/index.tsx`, `expo-image-picker` |
| Reconocer el texto de la foto | OCR en el dispositivo: ML Kit en Android y Vision en iOS | `expo-ocr-kit`, llamada a `recognizeText` |
| Identificar la fecha de vencimiento | El texto leído se normaliza y se buscan fechas; se prioriza la que está junto a palabras como VENC, EXP o caducidad | `src/lib/parse-expiration.ts` |
| Confirmar antes de guardar | Pantalla de revisión con la foto, las fechas encontradas, un campo de fecha y el nombre del producto | `src/app/index.tsx` |
| Guardar y listar en el teléfono | Tabla `vencimientos` en SQLite, ordenada por fecha | `src/lib/vencimientos-db.ts`, `expo-sqlite` |
| Indicar si el producto está por vencer | Cada tarjeta muestra la fecha en español y los días que faltan o que pasaron | `expirationStatus` en `src/lib/parse-expiration.ts` |
| Quitar un producto de la lista | Botón **Eliminar** con confirmación | `deleteVencimiento` |

## Flujo de la funcionalidad

```text
Tomar foto
    -> permiso de cámara
    -> foto en JPEG (calidad 0.85)
    -> recognizeText(uri)
    -> bloques de texto unidos por líneas
    -> extractExpirationDates + pickExpirationDate
    -> pantalla de revisión
    -> validar nombre y fecha día/mes/año
    -> INSERT en vencimientos
    -> lista ordenada por fecha
```

La cámara no recorta en un cuadro fijo. En iOS ese recorte es siempre cuadrado y suele cortar la fecha. Por eso la foto se toma completa y el mensaje de la pantalla pide acercar la fecha hasta que ocupe la imagen. La calidad `0.85` convierte la foto a JPEG para que el OCR no reciba un archivo HEIC difícil de leer.

## Cómo se aplicó cada parte

### Cámara

`takePhoto` en `src/app/index.tsx` pide el permiso con `ImagePicker.requestCameraPermissionsAsync`. Si el usuario lo niega, la app avisa y no abre la cámara. Si lo acepta, `launchCameraAsync` abre la cámara del sistema.

El permiso queda declarado en `app.json` mediante los plugins de `expo-image-picker` y `expo-ocr-kit`. El texto que ve el usuario es: "La app usa la cámara para fotografiar la fecha de vencimiento." El micrófono no se solicita (`microphonePermission: false`).

En la web la cámara con OCR no está disponible. El botón explica que hay que usar iPhone o Android.

### OCR

`recognizeText` de `expo-ocr-kit` recibe la ruta local de la foto y devuelve el texto completo y bloques con su posición. La app usa los bloques, uno por línea, porque en una etiqueta la palabra VENC y la fecha suelen estar en líneas distintas. Si no hay bloques, usa el texto completo.

El módulo es nativo. Expo Go no lo incluye. La app se ejecuta con un development build (`expo-dev-client`), instalado en el teléfono con `npx expo run:android`. En Android el motor es ML Kit. En iOS es el framework Vision.

### Identificación de la fecha

`src/lib/parse-expiration.ts` no llama al OCR. Trabaja sobre el texto ya leído. El proceso tiene tres pasos.

1. **Normalizar.** Se quitan tildes, se corrigen caracteres que la foto suele confundir (`O` por `0`, `I` por `1`, `S` por `5`) y se juntan dígitos que el OCR separó, por ejemplo `1 5 / 1 0 / 2 0 2 6`.
2. **Extraer.** Se buscan fechas con día, mes y año en estos formatos:
   - `15/03/2027`, `15-03-27`, `15.03.27`
   - `2027-03-15`
   - `15 MAR 2027`, `20 de octubre de 2026`, `15OCT26`
   - `03/2027`, `06/27`, `OCT 26` u `octubre 2028`, interpretados como el último día de ese mes
   - `15-OCT-26` y `2 de octubre del 2026`
   - una fecha partida en dos líneas, por ejemplo `15/10` y debajo `2026`
   - `15 10 2026` y, si está cerca de una palabra de vencimiento, `15 10 26`
   - `151026` o `15102026` cuando la línea dice VENC, EXP, F.V. u otra marca parecida
3. **Elegir.** Si hay varias fechas, gana la que está en la misma línea que `VENC`, `VTO`, `EXP`, `caducidad`, `best before` o `consume antes`, o en la línea siguiente. También se prefiere una fecha cercana, no una fecha de elaboración muy antigua.

La fecha elegida se muestra como `DD/MM/AAAA` para que el usuario pueda corregirla. Si no se encuentra ninguna, el campo queda vacío y se puede escribir a mano. No se guarda hasta que el nombre y la fecha sean válidos.

### Lista y persistencia

`src/app/_layout.tsx` abre la base con `SQLiteProvider` y ejecuta `migrateDbIfNeeded` antes de mostrar la pantalla. La tabla es:

```sql
CREATE TABLE vencimientos (
  id INTEGER PRIMARY KEY NOT NULL,
  nombre TEXT NOT NULL,
  fecha TEXT NOT NULL,
  texto_ocr TEXT,
  creado_en TEXT NOT NULL
);
```

`fecha` se guarda como `AAAA-MM-DD` para poder ordenar. `texto_ocr` conserva lo que leyó la cámara, por si hay que revisar la lectura. `creado_en` es la fecha y hora del guardado en ISO.

La lista consulta `ORDER BY fecha ASC`. Cada tarjeta muestra el nombre, la fecha en español (Perú) y un estado de color: rojo si ya venció, ámbar si faltan 7 días o menos, y verde en los demás casos.

## Estructura del código

```text
src/app/_layout.tsx          Arranque, base de datos y navegación
src/app/index.tsx            Pantalla de lista, foto y revisión
src/lib/vencimientos-db.ts   Crear tabla, listar, insertar y borrar
src/lib/parse-expiration.ts  Normalizar el OCR y elegir la fecha
src/components/themed-text.tsx
src/components/themed-view.tsx
src/constants/theme.ts       Colores, espacios y modo claro/oscuro
app.json                     Nombre, permisos de cámara y plugins nativos
metro.config.js              Permite cargar SQLite WebAssembly en la web
```

La navegación es una pila de Expo Router con una sola pantalla y sin barra de título. La plantilla inicial (pestaña Explore, pantalla de bienvenida y componentes de ejemplo) se retiró para dejar solo la foto y la lista.

## Librerías

### Las que implementan los requisitos

| Librería | Qué hace en este proyecto |
|---|---|
| `expo` 58 | Entorno de la app, configuración en `app.json` y comandos de desarrollo. |
| `react` y `react-native` | Interfaz y componentes nativos (`View`, `Text`, `Pressable`, `FlatList`). |
| `expo-router` | Define la pantalla `src/app/index.tsx` como ruta y el layout raíz. |
| `expo-image-picker` | Pide el permiso de cámara y abre la cámara para tomar la foto. |
| `expo-ocr-kit` | Lee el texto de esa foto dentro del teléfono. |
| `expo-sqlite` | Crea `vencimientos.db` y ejecuta las consultas de la lista. |
| `expo-image` | Muestra la foto en la pantalla de revisión. |
| `expo-dev-client` | Permite instalar una app de desarrollo con módulos nativos. Expo Go no puede cargar el OCR. |
| `expo-splash-screen` | Mantiene el splash hasta que la interfaz está lista y luego lo oculta. |
| `react-native-safe-area-context` | Respeta el notch y la barra del sistema para que el botón no quede tapado. |
| `typescript` | Revisa los tipos de las fechas, los registros y las respuestas del OCR. |

### Las que sostienen el proyecto Expo

Estas librerías vienen con el SDK y permiten compilar, navegar y adaptar la interfaz. No contienen la lógica de vencimientos.

| Librería | Función |
|---|---|
| `react-native-screens` | Pantallas nativas que usa Expo Router. |
| `react-native-gesture-handler` | Gestos que el enrutador necesita para navegar. |
| `expo-linking` | Abre la app instalada desde el enlace del development build. El esquema es `vencimientosapp`. |
| `expo-constants` | Expone la configuración de `app.json` en tiempo de ejecución. |
| `expo-status-bar` y `expo-system-ui` | Barra de estado y colores del sistema. |
| `expo-font` | Carga de fuentes del sistema de interfaz. |
| `react-native-web` y `react-dom` | Misma interfaz en el navegador. El OCR sigue siendo solo de teléfono. |

### Incluidas en el proyecto y no usadas por el flujo actual

Quedaron de la plantilla o de una prueba anterior. No participan en tomar la foto ni en guardar la lista.

| Librería | Situación |
|---|---|
| `@supabase/supabase-js` | Cliente de base remota. No hay pantalla ni consulta que lo use. |
| `@react-native-async-storage/async-storage` | Almacén clave-valor. Solo lo necesitaba el cliente de Supabase. |
| `react-native-url-polyfill` | Completa `URL` en React Native para Supabase. |
| `expo-notifications` | Notificaciones locales. No hay recordatorios programados. |
| `expo-device` | Datos del dispositivo. No se consultan en la pantalla actual. |
| `expo-file-system` | Archivos del teléfono. La foto se pasa por la URI que ya entrega la cámara. |
| `expo-web-browser` | Abrir enlaces en el navegador del sistema. No hay enlaces en la pantalla. |
| `expo-symbols`, `expo-glass-effect`, `@expo/ui` | Iconos y componentes visuales de la plantilla. |
| `react-native-reanimated` y `react-native-worklets` | Animaciones. El splash animado de la plantilla ya no se usa. |

## Cómo se ejecuta en el celular

El QR de Expo Go no abre este proyecto: Expo Go de la tienda no trae el módulo de OCR ni corresponde a este development build. La app se instala por cable, con depuración USB activada en el Samsung:

```bash
npx expo run:android
```

Ese comando genera el paquete nativo, lo instala y lo deja conectado al servidor de la computadora. Los cambios de código JavaScript se ven en el celular al recargar, mientras el cable y el servidor siguen activos. No hace falta reinstalar por un cambio de pantalla o de la lógica de fechas. Un cambio de librería nativa sí exige volver a ejecutar `npx expo run:android`.

Mientras se desarrolla, el servidor se puede levantar así para que el teléfono use el puerto de la computadora por el cable:

```bash
npx expo start --dev-client --localhost --port 8081
adb reverse tcp:8081 tcp:8081
```

## Límites conocidos

- La fecha se lee mejor si ocupa casi toda la foto, con luz y sin reflejo.
- Un lote, un código de barras o una fecha de elaboración pueden aparecer como otra fecha posible. La pantalla de revisión permite elegir o corregir antes de guardar.
- No hay aviso automático el día del vencimiento. `expo-notifications` está instalado, pero no se usa.
- La lista no se sincroniza entre teléfonos. Vive solo en el aparato donde se guardó.
- En el navegador se puede ver la lista vacía, pero no tomar la foto ni ejecutar el OCR.
