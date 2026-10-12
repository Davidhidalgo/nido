/** Shared by the native plugin page and the embedded settings panel. */
export function mealSettingsScript() {
  return String.raw`
{
const meals=document.createElement('section');
meals.innerHTML='<h2>Comidas y pantalla</h2><form><label>Hora de la comida <input name="lunch" type="time" required></label><label>Hora de la cena <input name="dinner" type="time" required></label><label><input name="dim" type="checkbox"> Atenuar comidas pasadas en el Note4</label><label>Minutos desde la hora de comida o cena <input name="minutes" type="number" min="0" max="1440" step="1" required value="120"></label><p>Se aplica a las comidas planificadas de hoy. El texto permanece legible. Los cambios aparecerán en la próxima sincronización del Note4.</p><p>Cambiar las horas no mueve los eventos que ya tienes guardados. Para que un plato con el horario anterior siga apareciendo como comida o cena, su título debe empezar por «Comida ·» o «Cena ·».</p><button type="submit" disabled>Guardar ajustes</button><button type="button">Actualizar ajustes</button><p role="status" aria-live="polite"></p></form>';
root.appendChild(meals);
const form=meals.querySelector('form'),field=name=>form.elements.namedItem(name),save=form.querySelector('[type=submit]'),reload=form.querySelector('[type=button]'),message=form.querySelector('[role=status]');
let version='',saving=false;
field('dim').onchange=()=>{field('minutes').disabled=!field('dim').checked;};
async function readMeals(){const s=await host.client.request('nido.meals.get',{});version=s.version;field('lunch').value=s.lunch;field('dinner').value=s.dinner;field('dim').checked=s.mealDimmingMinutes!==null;field('minutes').value=String(s.mealDimmingMinutes??120);field('dim').onchange();save.disabled=false;return s;}
reload.onclick=async()=>{if(saving)return;try{await readMeals();message.textContent='Ajustes actualizados.';}catch(e){message.textContent=e.message||'No se pudieron consultar los ajustes.';}};
form.onsubmit=async event=>{event.preventDefault();if(saving||!version||!form.reportValidity())return;
const payload={version,lunch:field('lunch').value,dinner:field('dinner').value,mealDimmingMinutes:field('dim').checked?Number(field('minutes').value):null};
saving=true;save.disabled=true;reload.disabled=true;
try{const result=await host.client.request('nido.meals.save',payload);message.textContent=result.warning||'Ajustes guardados. Se aplicarán en la próxima sincronización.';version='';}
catch(e){message.textContent='No se pudo confirmar el guardado. Actualiza los ajustes antes de repetir. '+(e.message||'');}
finally{saving=false;reload.disabled=false;try{await readMeals();}catch{save.disabled=true;message.textContent+=' Pulsa Actualizar ajustes cuando OpenClaw termine de recargar.';}}
};
readMeals().catch(e=>{message.textContent=e.message||'No se pudieron consultar los ajustes.';});
}
`;
}
