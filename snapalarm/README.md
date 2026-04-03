# SnapAlarm

Monorepo con:

- API en `apps/api`
- App móvil Expo/React Native en `apps/mobile`
- Paquetes compartidos en `packages/*`

## Requisitos

- Node.js 20+
- Yarn 1.22+
- Docker Desktop
- Android Studio + emulador Android o Expo Go en dispositivo físico

## Estructura

```text
apps/
  api/
  mobile/
packages/
  ai-service/
  image-processor/
  retry-engine/
  shared-types/
```

## Configuración inicial

1. Instala dependencias:

```powershell
yarn.cmd install
```

2. Copia variables de entorno:

```powershell
Copy-Item .env.example .env
```

3. Si usas emulador Android, la app móvil usa por defecto:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

4. Si usas un dispositivo físico, cambia `EXPO_PUBLIC_API_URL` por la IP local de tu PC:

```env
EXPO_PUBLIC_API_URL=http://192.168.0.11:3000
```

## Primer arranque

1. Levanta Postgres y Redis:

```powershell
docker compose up -d postgres redis
```

2. Genera Prisma:

```powershell
yarn.cmd workspace @snapalarm/api prisma:generate
```

3. Aplica migraciones:

```powershell
yarn.cmd workspace @snapalarm/api prisma:migrate
```

4. Arranca todo:

```powershell
yarn.cmd dev
```

## Scripts útiles

### Todo el proyecto

```powershell
yarn.cmd dev
```

Levanta API + mobile al mismo tiempo.

### Solo API

```powershell
yarn.cmd dev:api
```

### Solo mobile

```powershell
yarn.cmd dev:mobile
```

### Mobile con Expo Go

```powershell
yarn.cmd dev:mobile:go
```

### Mobile para Android por LAN

```powershell
yarn.cmd dev:mobile:android
```

### Mobile limpiando caché

```powershell
yarn.cmd dev:mobile:clean
```

Útil si Expo empieza a fallar con rutas, bundle o módulos nativos.

## Verificar que la API está viva

Con la API corriendo:

```powershell
curl http://localhost:3000/health
```

Debe devolver algo como:

```json
{"status":"ok","timestamp":"..."}
```

## Desarrollo en Android Emulator

La app móvil usa `10.0.2.2` para conectarse a la API local cuando corre en Android.

Eso permite que el emulador llegue a tu máquina host en `localhost:3000`.

## Problemas comunes

### 1. `Cannot find native module 'ExpoLinking'`

Posibles causas:

- dependencias Expo mezcladas entre SDKs
- caché vieja de Expo
- Expo Go/build incorrecto

Qué hacer:

```powershell
yarn.cmd install
yarn.cmd dev:mobile:clean
```

### 2. `Registration failed / Please try again`

Suele significar que la API no respondió.

Revisa:

```powershell
curl http://localhost:3000/health
```

Si no responde, vuelve a lanzar:

```powershell
yarn.cmd dev:api
```

### 3. Expo abre en `127.0.0.1:8081`

No siempre es un problema para el bundle, pero la API del emulador no debe usar `localhost`.

Para Android Emulator, usa:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

### 4. `Port 8081 is being used by another process`

Busca el PID:

```powershell
netstat -ano | findstr :8081
```

Mátalo:

```powershell
taskkill /PID TU_PID /F
```

### 5. Git sigue mostrando `node_modules`

Eso pasa si ya estaban trackeados antes de crear `.gitignore`.

Comprueba:

```powershell
git ls-files | Select-String "node_modules"
```

## Notas

- `.env` no debe subirse al repo
- `.env.example` sí debe mantenerse actualizado
- `docker-compose.yml` muestra un warning por `version`; hoy Docker lo ignora, pero se puede limpiar más adelante

