import { note4SettingsScript } from "./note4-settings.js";
import { calendarPanel } from "./calendar-panel.js";
/** Static module only. Account data travels through authenticated native Gateway RPC. */
export function calendarSettingsModule() {
  const panel = calendarPanel({});
  const script = panel
    .match(/<script>([\s\S]*)<\/script>/)![1]
    .replace("()=>location.reload()", "()=>host.load()")
    .replace(
      "const credential=document.getElementById('credential');if(!credential.value){status.textContent='Introduce la credencial del Gateway para guardar.';credential.focus();return;}",
      "",
    )
    .replace(
      /const response=await fetch\([\s\S]*?const result=await response.json\(\);credential.value='';if\(!response.ok\)\{[\s\S]*?return;\}/,
      "const result=await host.client.request('nido.calendars.configure',payload);",
    )
    .replace(
      "credential.value='';status.textContent='No se pudo confirmar el guardado. Actualiza la lista antes de repetir.';",
      "status.textContent='No se pudo confirmar el guardado. Actualiza la lista antes de repetir.';",
    );
  const markup = panel
    .replace(/<script>[\s\S]*?<\/script>/, "")
    .replace(
      /<footer><p>[\s\S]*?<div class="toolbar"><input id="credential"[^>]*>/,
      '<footer><p>Los cambios se guardan con tu sesión administrativa de OpenClaw. Google limita el acceso efectivo.</p><div class="toolbar">',
    )
    .replace(/body\{/g, ":host{");
  return `const markup=${JSON.stringify(markup)};
class NidoCalendarSettings extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});if(Object.hasOwn(this,'client')){const value=this.client;delete this.client;this.client=value;}}
  set client(value){if(this._client===value)return;this._client=value;if(this.isConnected)this.load();}
  get client(){return this._client;}
  connectedCallback(){this.load();}
  async load(){
    if(!this.client){this.shadowRoot.textContent='Conecta con OpenClaw para consultar los calendarios.';return;}
    this.shadowRoot.textContent='Consultando calendarios…';
    try {
      const metadata=await this.client.request('nido.calendars.catalog',{});
      if(!this.isConnected)return;
      this.shadowRoot.innerHTML=markup;
      this.shadowRoot.getElementById('data').textContent=JSON.stringify(metadata);
      this.bind();
    } catch {this.shadowRoot.textContent='No se pudo consultar la cuenta. Vuelve a abrir los ajustes de Nido.';}
  }
  bind(){const host=this,root=this.shadowRoot,document={getElementById:id=>root.getElementById(id),createElement:tag=>root.ownerDocument.createElement(tag)};
${script}
${note4SettingsScript()}
  }
}
if(!customElements.get('nido-calendar-settings'))customElements.define('nido-calendar-settings',NidoCalendarSettings);
`;
}
