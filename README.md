# Pointix Sheet Copy

Complemento para copiar celdas y rangos de **Sheet Plus en Obsidian**. Funciona de forma independiente de [Pointix Sheet Navigation](https://github.com/ExplorerAS/Pointix-Sheet-Navigation); puedes usar ambos.

## Installation / Instalación

Busca **Pointix Sheet Copy** en **Ajustes → Complementos comunitarios → Explorar**. Instala y activa también **Sheet Plus**, que proporciona las hojas de cálculo.

Para instalación manual, coloca `main.js`, `manifest.json` y `styles.css` en `.obsidian/plugins/pointix-sheet-copy/`. Reinicia Obsidian o recarga los complementos y activa **Pointix Sheet Copy**. Los tres archivos deben corresponder a la misma versión.

## Usage / Uso

### Abrir el panel de copia

- **Teléfono o tableta:** abre una hoja completa de Sheet Plus, selecciona una celda y mantenla presionada para abrir el panel de Pointix. El panel tiene desplazamiento propio; ciérralo con **×** o tocando fuera. Si el teclado está visible, el panel se acomoda sobre él.
- **PC o Mac:** haz clic derecho en la hoja. El panel de Pointix aparece junto al menú de Sheet Plus. También puedes ejecutar **Pointix Sheet Copy: Abrir panel de copiado** desde la paleta de comandos.

El panel y los formatos de copia se ofrecen en la vista completa de Sheet Plus. Las hojas incrustadas en notas no tienen todavía el panel de copia porque no se puede identificar con seguridad su instancia de hoja.

## Copiar

Después de seleccionar una celda o rango, elige la opción que necesites. El copiado de texto conserva el orden de filas y columnas al pegar en Sheet Plus, WPS, Excel y Google Sheets. En Windows se comprobó también el copiado con formato y la tabla Markdown.

| Opción | Resultado |
| --- | --- |
| Copiar contenido · WPS, Excel, Sheet Plus y más | Texto con tabulaciones y saltos de línea para conservar filas y columnas. |
| Copiar fórmula de la celda | Fórmula de la selección; las celdas sin fórmula quedan vacías. |
| Copiar contenido y fórmula | Fórmulas donde las haya y contenido en las demás celdas, como texto tabulado. |
| Copiar con formato, colores y diseño | Tabla HTML y texto alternativo; intenta conservar estilos, bordes, combinaciones y tamaños disponibles en Sheet Plus. |
| Copiar formato, contenido y fórmula | Tabla HTML con fórmulas como contenido de las celdas calculadas y texto alternativo. El destino determina cómo interpreta esas fórmulas. |
| Copiar como tabla Markdown | Tabla para una nota Markdown. |
| Copiar como CSV | Texto separado por comas. |

El pegado con formato depende de que la aplicación de destino acepte HTML del portapapeles. Si el dispositivo no lo acepta, el complemento copia texto y lo informa. Las fórmulas copiadas a otra hoja pueden mostrar avisos de inconsistencia o requerir ajustar referencias fijas y relativas en el destino.

**WPS en móvil:** durante las pruebas, el contenido y las celdas se pegaron en orden, pero el formato visual cambió de forma intermitente entre intentos. Si los colores o estilos no coinciden, comprueba el resultado y repite el pegado o usa **Copiar contenido**. En Google Sheets y Sheet Plus móvil, las opciones probadas conservaron correctamente el contenido; el resultado final también depende de la aplicación receptora.

### Seleccionar un rango

1. Selecciona la primera celda de una **hoja completa** de Sheet Plus y abre el panel.
2. Pulsa **Seleccionar rango…**. La barra de Pointix muestra la referencia, por ejemplo `A2:D7`.
3. Toca la celda final, arrastra para seleccionar o usa las flechas de la barra. En móvil, **Mover la hoja** cambia entre la selección de rango y el desplazamiento mientras la barra está abierta. Haz los ajustes de rango poco a poco y verifica la referencia que muestra la barra.
4. Pulsa **Copiar…** para elegir el formato. **Cancelar** sale del modo de rango. La barra flota sobre Sheet Plus: mantén presionado su título **Pointix Sheet Copy** y arrástrala a otra posición si tapa alguna celda. Al abrirse el teclado, la barra se recoloca dentro del área visible.

En móvil, el modo de rango transforma los gestos sobre la hoja para construir la selección; **Mover la hoja** permite desplazarse durante ese modo. Fuera de él, Navigation conserva sus propios gestos. El manejo de hojas extensas en una pantalla pequeña puede requerir varios movimientos de la barra y de la hoja.

### Atajos

- **Pantalla táctil o lápiz:** doble toque para copiar rápidamente una celda. Si tienes Navigation activo, su gesto de copia se comunica con Copy.
- **Windows/Linux:** `Ctrl` + clic para copiar una celda.
- **macOS:** `Cmd` + clic para copiar una celda.
- Puedes asignar atajos a las acciones desde **Ajustes → Atajos de teclado**.

En PC, **Alt/Option + arrastrar** desplaza hojas incrustadas en notas cuando la opción correspondiente está activada en los ajustes de Copy. Si también utilizas Navigation, comprueba el gesto en tu configuración antes de depender de él.

## Diagnóstico y soporte

En los ajustes de Pointix Sheet Copy puedes activar **Diagnóstico de selección en el móvil**. La barra mostrará los toques recibidos y la referencia de la hoja; comparte una captura si la selección no responde. Desactívalo al terminar.

Para reportar un problema, escribe a **[servicios.globix@gmail.com](mailto:servicios.globix@gmail.com)** o abre un [issue en GitHub](https://github.com/ExplorerAS/Pointix-Sheet-Copy/issues). Indica el dispositivo, sistema operativo, versiones de Obsidian y Sheet Plus, si usas Pointix Sheet Navigation, los pasos realizados, el resultado esperado y lo que ocurrió. Una grabación breve ayuda cuando el fallo es visual.

## Privacidad y apoyo

Pointix Sheet Copy procesa la hoja localmente al copiar, no solicita credenciales y no envía el contenido por red. Sheet Plus, Obsidian Sync, el sistema operativo y las aplicaciones donde pegues tienen sus propias políticas.

Si te resulta útil, puedes **[invitarnos un café en Ko-fi](https://ko-fi.com/exprorerit)**. El apoyo es voluntario y no desbloquea funciones ni modifica el soporte.
