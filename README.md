# Agenda Ferretería

**Abrir la app:** <https://acembrero-droid.github.io/agenda_estudi/>

Una app web para la tienda:

- **Registro de visitas a la tienda.** Apuntas quién vino, su teléfono y qué necesita, con **etiquetas** (Encargo, Fontanería, Urgente… y las que añadas). Luego puedes buscar por texto, etiquetas, estado (Pendiente/Resuelto) y fechas, y ver el **historial de cada cliente**.
- **Agenda** en Google Calendar, con vista de **mes** o de lista, para tres tipos de cita:
  - **Visitas a clientes** (a domicilio).
  - **Citas en tienda.**
  - **Reparaciones**, con su estado (Recibido → En reparación → Esperando pieza → Listo para recoger → Entregado).

  Todas pueden llevar la **dirección** del cliente (con enlace a Google Maps) y el **operador asignado**.
- **WhatsApp:** botón en cada visita, cita o reparación que abre WhatsApp con el mensaje ya escrito a partir de una plantilla editable. Al marcar una reparación como "Listo para recoger", la app ofrece avisar al cliente.
- **Operadores:** das de alta a las personas que atienden, cada una con su color. Al elegir quién está usando la app, cambia el color de la cabecera y del fondo, y su nombre queda guardado en cada visita y cita.
- **Fotos:** cada visita, cita o reparación puede tener fotos con una descripción. Se hacen con el móvil (también escaneando un código QR desde el ordenador) y se guardan en tu Google Drive.
- **Llaves en bruto:** escribes la referencia y la buscas de una vez en todos tus proveedores (Ibermadrid, Marcabel, Illanes…). Puedes añadir, editar, desactivar o eliminar proveedores.

### Dónde se guarda cada cosa

| Qué | Dónde |
|---|---|
| Citas, visitas a clientes y reparaciones | Tu **Google Calendar** |
| Registro de visitas, etiquetas, plantillas de WhatsApp, proveedores y operadores | Una hoja de cálculo de tu **Google Drive** llamada **"Agenda Ferretería – Datos"**, que crea la app sola |
| Fotos | La carpeta **"Agenda Ferretería – Fotos"** de tu Google Drive |
| ID de Google, operador elegido, nombre del negocio y búsquedas recientes de llaves | Solo en el navegador de cada dispositivo |

Como todo está en tu cuenta de Google, lo ves igual en el ordenador, el móvil y la tablet. La hoja de cálculo también se puede abrir directamente en Google Sheets para filtrar, imprimir o exportar a Excel.

---

## 1. Configurar Google (una sola vez, unos 10 minutos)

1. Entra en <https://console.cloud.google.com/> con la cuenta de Google de la tienda.
2. Crea un proyecto (por ejemplo, "Agenda Ferretería").
3. **APIs y servicios → Biblioteca**: busca y **habilita** estas tres APIs:
   - **Google Calendar API**
   - **Google Sheets API**
   - **Google Drive API**
4. **APIs y servicios → Pantalla de consentimiento de OAuth** (o "Google Auth Platform"):
   - Tipo de usuario: **Externo**.
   - Rellena el nombre de la app y tu correo.
   - En **Usuarios de prueba** (o "Público") añade tu correo y el de quien vaya a usarla.
5. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - **Orígenes de JavaScript autorizados**: añade `https://acembrero-droid.github.io`
     (solo eso, sin `/agenda_estudi` ni barra al final). Si además la abres en local, añade también `http://localhost:8000`.
   - Guarda y copia el **ID de cliente** (termina en `.apps.googleusercontent.com`).
6. En la app: pestaña **Ajustes** → pega el ID → **Guardar** → **Conectar con Google**.
7. En la ventana de Google, **marca todas las casillas de permisos** (calendario y archivos de Drive).

La primera vez Google mostrará el aviso "Google no ha verificado esta aplicación". Es normal porque la app es tuya y no está publicada: pulsa **Configuración avanzada → Ir a Agenda Ferretería**.

**Qué ve la app de tu Drive:** solo los archivos que ha creado ella (la hoja "Agenda Ferretería – Datos" y la carpeta de fotos). No puede ver el resto de tu Drive.

**Si ya la tenías conectada con la versión anterior:** activa Google Sheets API y Google Drive API (paso 3) y pulsa **Reconectar con Google** para dar el permiso nuevo.

## 2. Dónde abrir la app

Está publicada en GitHub Pages: <https://acembrero-droid.github.io/agenda_estudi/>. Para tenerla a mano en el móvil, ábrela y usa **"Añadir a pantalla de inicio"**.

Abrir el `index.html` con doble clic **no sirve**, porque Google no admite direcciones `file://`. Para probarla en local, ejecuta en la carpeta de la app:

```bash
python3 -m http.server 8000
```

y abre <http://localhost:8000>.

> El repositorio es **público**: cualquiera puede ver el código, pero no tus datos. El ID de cliente se escribe en la propia app y se queda en tu navegador; los datos están en tu cuenta de Google.

### Usar la app en el móvil o la tablet

En el ordenador, ve a **Ajustes → Usar la app en el móvil** y escanea el código QR con la cámara del móvil. Se abre la app con el ID de Google ya puesto. Después pulsa **Conectar con Google** con la **misma cuenta de Google** que en el ordenador.

## 3. Operadores (quién atiende)

En **Ajustes → Operadores** das de alta a cada persona con su nombre y un color. Arriba, en **Operador**, cada uno elige quién es al empezar a usar la app en ese dispositivo:

- La cabecera y el fondo de la app se ponen del color de esa persona, para que se vea claramente quién está atendiendo.
- Su nombre se pone solo en **Atendido por** (registro) y en **Operador asignado** (citas). Se puede cambiar en cada ficha; por ejemplo, para asignar una visita a domicilio a otra persona.
- En el registro y en la agenda puedes filtrar por operador.
- Si das de baja a un operador, las visitas y citas que ya tienen su nombre lo conservan.

> **Importante: los operadores no son cuentas con contraseña.** Sirven para saber quién hizo cada cosa, no para impedir el acceso. Cualquiera que use la app puede elegir cualquier nombre. La app está pensada para que la tienda use **una sola cuenta de Google** en todos los dispositivos. Si cada persona entrara con su propia cuenta de Google, no vería la hoja de datos ni la carpeta de fotos, que son de la cuenta que las creó.

## 4. Fotos

Cada visita del registro, cita y reparación tiene un botón **📷 Fotos**:

- **Desde el móvil:** abre la ficha, pulsa **📷 Fotos → Hacer foto** y se abre la cámara. Puedes añadir una descripción (medida, referencia de la pieza…).
- **Desde el ordenador:** en la ventana de fotos, abre **Hacer la foto con el móvil (código QR)** y escanéalo con el móvil. El móvil abre directamente esa ficha: pulsas **Conectar con Google**, haces la foto, y en el ordenador aparece sola en unos segundos.

Las fotos se reducen antes de subirlas (a 1600 píxeles como mucho) para que suban rápido y no llenen el Drive. Se guardan en la carpeta **"Agenda Ferretería – Fotos"** de tu Google Drive. Si borras una visita o una cita, la app borra también sus fotos.

## 5. Calendarios

En **Ajustes → Calendarios** eliges dónde se guarda cada tipo de cita. Recomiendo crear en Google Calendar un calendario **"Visitas a clientes"** aparte: así puedes mostrarlo u ocultarlo en el móvil y compartirlo con quien hace las visitas. También puedes usar el principal para todo, porque las citas ya se distinguen por color:

- **Verde:** visita a cliente
- **Azul:** cita en tienda
- **Naranja:** reparación

## 6. Registro de visitas y etiquetas

- **Fecha y hora** se rellenan solas con el momento actual.
- Si escribes el nombre de un cliente que ya vino, el teléfono se completa solo.
- **Etiquetas:** pulsa las que quieras para marcarlas, o escribe una nueva y pulsa **Añadir**. Para quitar una de la lista, ve a **Gestionar etiquetas**; las visitas que ya la tienen la conservan.
- **Búsqueda:** escribe palabras (sin preocuparte de tildes ni mayúsculas). Si marcas varias etiquetas, salen las visitas que tienen **todas** ellas.
- Cada visita tiene botones para editar, marcar como resuelta, enviar WhatsApp, ver el historial del cliente y crear una cita a partir de ella.

## 7. WhatsApp

El botón **WhatsApp** abre una ventana con el teléfono y el mensaje ya escrito a partir de una plantilla, que puedes retocar. Al pulsar **Abrir WhatsApp** se abre WhatsApp (la app del móvil, WhatsApp Desktop o WhatsApp Web) con ese chat y el mensaje listo: **tú pulsas enviar**.

- Los números de 9 cifras se tratan como españoles (se añade el +34). Para otros países, escribe el número con `+` y el prefijo.
- Las plantillas se editan en **Ajustes → Plantillas de WhatsApp**. Datos que se rellenan solos: `{cliente}`, `{fecha}`, `{hora}`, `{articulo}`, `{presupuesto}`, `{direccion}`, `{necesidad}`, `{tienda}` y `{operador}`. Si un dato está vacío, por ejemplo el presupuesto, la línea que lo contiene no se incluye en el mensaje.
- Pon el nombre de tu negocio en **Ajustes → Datos del negocio** para que salga en los mensajes.

> **Por qué no se envía solo:** el envío automático requiere la API oficial de WhatsApp Business (Meta). Eso supone verificar la empresa, tener un servidor, usar plantillas aprobadas por Meta y pagar por conversación. Para el volumen de una tienda, abrir el chat con el mensaje escrito es lo práctico y no cuesta nada.

## 8. Proveedores de llaves

Por defecto, Ibermadrid, Marcabel e Illanes **buscan en Google** (por ejemplo, "Ibermadrid llave TE8"). Para que la búsqueda vaya directa a la web de cada proveedor:

1. Entra en su web (con tu usuario si es zona profesional) y busca una referencia, por ejemplo `TE8`.
2. Copia la dirección de la página de resultados, por ejemplo `https://web.es/buscar?q=TE8`.
3. Cambia `TE8` por `{q}` y pégala en **Editar** de ese proveedor: `https://web.es/buscar?q={q}`.

Si al buscar la dirección no cambia, esa web no permite enlazar búsquedas directamente: deja la búsqueda en Google.

## Limitaciones

- **Llaves:** la app abre la búsqueda en cada proveedor (una pestaña por proveedor), no junta los resultados en una pantalla. Para juntarlos haría falta un servidor que lea sus webs, y las zonas de profesionales piden tu usuario.
- **WhatsApp:** no envía mensajes automáticamente (ver arriba).
- **Volumen del registro:** la búsqueda carga todo el registro en el navegador. Va bien con varios miles de visitas; muestra como mucho las 200 más recientes de cada búsqueda.
- **Permiso de Google:** dura una hora. Pasado ese tiempo, puede aparecer de nuevo la ventana de Google al hacer algo (un clic).
- **Fotos y operadores:** requieren que todos los dispositivos usen la misma cuenta de Google (ver el apartado 3).
- **Ediciones simultáneas:** si dos personas editan la misma visita a la vez, se guarda la última.
