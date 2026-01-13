# WhatsApp Client - Especificación Técnica

## Descripción General

Cliente de WhatsApp para uso personal que permite recibir y visualizar mensajes en tiempo real a través de una conexión WebSocket directa con los servidores de WhatsApp.

---

## Funcionalidades

### Conexión y Autenticación

- Generación de código QR para vinculación inicial con cuenta de WhatsApp
- Autenticación automática en sesiones posteriores mediante credenciales almacenadas localmente
- Reconexión automática ante pérdidas de conexión
- Soporte para modo multi-dispositivo de WhatsApp

### Recepción de Mensajes

- Mensajes de texto simples
- Mensajes de texto extendido (con menciones, enlaces, formato)
- Imágenes con caption
- Videos con caption
- Documentos (con nombre de archivo)
- Mensajes de audio
- Stickers
- Ubicaciones (coordenadas geográficas)
- Contactos compartidos

### Identificación de Remitentes

- Extracción del número de teléfono del remitente
- Nombre de perfil del remitente
- Diferenciación entre mensajes individuales y grupales
- Identificación del grupo de origen en mensajes grupales

### Filtrado de Mensajes

- Exclusión de mensajes propios
- Exclusión de estados/broadcast
- Procesamiento únicamente de mensajes nuevos (no historial)

### Visualización

- Presentación formateada en consola
- Marca temporal de cada mensaje
- Indicador de tipo de contenido para mensajes multimedia

---

## Tecnologías

### Lenguaje y Runtime

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| TypeScript | 5.x | Lenguaje principal con tipado estático |
| Node.js | 18+ | Entorno de ejecución |

### Dependencias Principales

| Librería | Propósito |
|----------|-----------|
| @whiskeysockets/baileys | API de WhatsApp Web vía WebSocket |
| @hapi/boom | Manejo estructurado de errores HTTP |
| pino | Logger de alto rendimiento |
| qrcode-terminal | Renderizado de códigos QR en terminal |

### Dependencias de Desarrollo

| Librería | Propósito |
|----------|-----------|
| typescript | Compilador de TypeScript |
| ts-node | Ejecución directa de TypeScript |
| @types/node | Definiciones de tipos para Node.js |

---

## Protocolos y Estándares

### Comunicación

- **WebSocket**: Conexión bidireccional persistente con servidores de WhatsApp
- **TLS 1.3**: Cifrado de la capa de transporte
- **Puerto 443**: Puerto estándar HTTPS para evitar bloqueos de firewall

### Seguridad

- **Signal Protocol**: Cifrado end-to-end de mensajes
- **Noise Protocol**: Establecimiento de canal seguro con servidores
- **Curve25519**: Intercambio de claves criptográficas
- **AES-256-GCM**: Cifrado simétrico de contenido

### Serialización

- **Protocol Buffers (Protobuf)**: Formato binario para mensajes WhatsApp

---

## Arquitectura

### Componentes

```
┌────────────────────────────────────────────────────┐
│                   Aplicación                       │
├────────────────────────────────────────────────────┤
│  Capa de Presentación                              │
│  - Formateo de mensajes                            │
│  - Salida a consola                                │
├────────────────────────────────────────────────────┤
│  Capa de Lógica                                    │
│  - Procesamiento de mensajes                       │
│  - Extracción de contenido                         │
│  - Identificación de remitentes                    │
├────────────────────────────────────────────────────┤
│  Capa de Conexión (Baileys)                        │
│  - Gestión de WebSocket                            │
│  - Cifrado/Descifrado                              │
│  - Autenticación                                   │
├────────────────────────────────────────────────────┤
│  Almacenamiento Local                              │
│  - Credenciales de sesión                          │
│  - Claves criptográficas                           │
└────────────────────────────────────────────────────┘
```

### Flujo de Datos

1. Establecimiento de conexión WebSocket con servidores WhatsApp
2. Autenticación mediante credenciales almacenadas o código QR
3. Recepción de mensajes cifrados vía WebSocket
4. Descifrado local usando Signal Protocol
5. Deserialización de Protobuf a objetos JavaScript
6. Procesamiento y extracción de información relevante
7. Presentación formateada al usuario

---

## Almacenamiento

### Credenciales de Sesión

| Dato | Descripción |
|------|-------------|
| Claves de identidad | Par de claves Curve25519 del dispositivo |
| Claves de sesión | Claves para comunicación con cada contacto |
| Tokens de autenticación | Identificadores de sesión con servidores |
| Metadata de cuenta | Información básica de la cuenta vinculada |

### Ubicación

- Directorio local `auth_info/`
- Formato JSON
- Persistencia entre ejecuciones

---

## Requisitos del Sistema

### Hardware Mínimo

- 512 MB RAM disponible
- 100 MB espacio en disco
- Conexión a internet estable

### Software

- Sistema operativo: Windows, macOS o Linux
- Node.js versión 18 o superior
- npm o yarn

### Red

- Acceso a puertos 443 y 5222
- Sin restricciones a dominios de WhatsApp

---

## Limitaciones

- No es una API oficial de WhatsApp
- Riesgo potencial de bloqueo de cuenta por parte de WhatsApp
- Dependencia de ingeniería inversa del protocolo de WhatsApp
- Puede dejar de funcionar si WhatsApp modifica su protocolo
- No incluye funcionalidades empresariales de WhatsApp Business API

---

## Consideraciones de Seguridad

- Las credenciales se almacenan localmente sin cifrado adicional
- El directorio `auth_info/` no debe compartirse ni subirse a repositorios
- El acceso a las credenciales permite suplantar la sesión de WhatsApp
- Se recomienda ejecutar en un entorno controlado y seguro