# Agenda Ferretería

**Abrir la app:** <https://acembrero-droid.github.io/agenda_estudi/>

Una app web para:

- **Agenda** de citas de ferretería y de reparaciones, guardada en tu **Google Calendar**.
- **Reparaciones**: listado con su estado (Recibido → En reparación → Esperando pieza → Listo para recoger → Entregado), que se cambia desde la app.
- **Llaves en bruto**: escribes la referencia y la buscas de una vez en todos tus proveedores (Ibermadrid, Marcabel, Illanes…). Puedes añadir, editar, desactivar o eliminar proveedores.

Son tres archivos (`index.html`, `styles.css`, `app.js`) y no necesitan servidor propio ni base de datos.

---

## 1. Crear el ID de cliente de Google (una sola vez, unos 10 minutos)

Hace falta para que Google te deje conectar la app con tu calendario.

1. Entra en <https://console.cloud.google.com/> con la cuenta de Google del calendario.
2. Crea un proyecto nuevo (por ejemplo, "Agenda Ferretería").
3. **APIs y servicios → Biblioteca** → busca **Google Calendar API** → **Habilitar**.
4. **APIs y servicios → Pantalla de consentimiento de OAuth** (o "Google Auth Platform"):
   - Tipo de usuario: **Externo**.
   - Rellena el nombre de la app y tu correo.
   - En **Usuarios de prueba** añade tu propio correo (y el de quien vaya a usarla).
5. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - **Orígenes de JavaScript autorizados**: añade `https://acembrero-droid.github.io`
     (solo eso, sin `/agenda_estudi` ni barra al final). Si además la abres en local, añade también `http://localhost:8000`.
   - Guarda y copia el **ID de cliente** (termina en `.apps.googleusercontent.com`).
6. En la app: pestaña **Ajustes** → pega el ID → **Guardar** → **Conectar Google Calendar**.

La primera vez Google mostrará el aviso "Google no ha verificado esta aplicación". Es normal porque la app es tuya y no está publicada: pulsa **Configuración avanzada → Ir a Agenda Ferretería**.

> En modo de prueba, Google solo deja entrar a los correos de la lista de "Usuarios de prueba" (hasta 100).

## 2. Dónde abrir la app

Está publicada en GitHub Pages: <https://acembrero-droid.github.io/agenda_estudi/>. Funciona en el ordenador, en el móvil y en la tablet.

Abrir el `index.html` con doble clic **no sirve**, porque Google no admite direcciones `file://`. Para probarla en local, ejecuta en la carpeta de la app:

```bash
python3 -m http.server 8000
```

y abre <http://localhost:8000>.

> El repositorio es **público**: cualquiera puede ver el código, pero no tus datos. El ID de cliente se escribe en la propia app y se queda en tu navegador; las citas están en tu Google Calendar.

## 3. Calendarios

En **Ajustes → Calendarios** eliges dónde se guarda cada tipo de cita. Recomiendo crear en Google Calendar dos calendarios, "Ferretería" y "Reparaciones": así puedes mostrar u ocultar cada uno en el móvil. También puedes usar el principal para los dos, porque las citas ya se distinguen por color (azul para ferretería, naranja para reparaciones).

Los datos de cada reparación (cliente, teléfono, artículo, presupuesto y estado) se guardan dentro del evento de Calendar, así que también se ven desde la app de Google Calendar del móvil.

## 4. Proveedores de llaves

Por defecto, Ibermadrid, Marcabel e Illanes **buscan en Google** (por ejemplo, "Ibermadrid llave TE8"). Para que la búsqueda vaya directa a la web de cada proveedor:

1. Entra en su web (con tu usuario si es zona profesional) y busca una referencia, por ejemplo `TE8`.
2. Copia la dirección de la página de resultados, por ejemplo `https://web.es/buscar?q=TE8`.
3. Cambia `TE8` por `{q}` y pégala en **Editar** de ese proveedor: `https://web.es/buscar?q={q}`.

Si al buscar la dirección no cambia, esa web no permite enlazar búsquedas directamente: deja la búsqueda en Google.

**Exportar / Importar** guarda la lista de proveedores en un archivo, para pasarla a otro ordenador o navegador.

## Limitaciones

- La app **abre la búsqueda en cada proveedor** (una pestaña por proveedor). No junta los resultados en una sola pantalla: para eso habría que leer sus webs desde un servidor, y los navegadores no lo permiten si el proveedor no lo autoriza. Además, las zonas de profesionales piden tu usuario.
- Los **proveedores, ajustes y búsquedas recientes** se guardan en el navegador que uses. En otro dispositivo hay que importarlos (con Exportar / Importar). Las **citas** sí están en Google y se ven en todos lados.
- El permiso de Google dura una hora. Pasado ese tiempo, al recargar puede aparecer de nuevo la ventana de Google (un clic).
