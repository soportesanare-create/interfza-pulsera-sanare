/**
 * app.js
 * Lógica principal del Dashboard Monitor de Signos Vitales
 * 
 * INTEGRADOR DE BLUETOOTH REAL (Web Bluetooth API)
 * Este script intenta conectarse nativamente al reloj usando perfiles médicos estándar.
 * IMPORTANTE: Requiere usar Google Chrome o Microsoft Edge en tu PC y tener el BT encendido.
 */

// Elementos UI
const btnConnect = document.getElementById('btn-connect');
const btnTriggerScan = document.getElementById('btn-trigger-scan'); // Botón de Escaneo Manual
const statusIndicator = document.getElementById('status-indicator');
const deviceConnectionStateText = document.getElementById('device-connection-state');

// Valores de Tarjetas
const valSpo2 = document.getElementById('val-spo2');
const valHr = document.getElementById('val-hr');
const valPulse = document.getElementById('val-pulse');
const valBp = document.getElementById('val-bp'); 

const watchScreenValue = document.getElementById('watch-screen-value');
const valLastSync = document.getElementById('val-lastsync');
const alertsList = document.getElementById('alerts-list');

// Elementos de Paciente Modal
const modalOverlay = document.getElementById('patient-modal');
const patientForm = document.getElementById('patient-form');
const patientInfoCard = document.getElementById('patient-info-card');
const displayPName = document.getElementById('display-p-name');
const displayPDetails = document.getElementById('display-p-details');
const avatarInitial = document.getElementById('avatar-initial');
const btnSaveRecord = document.getElementById('btn-save-database');

// Estado
let bluetoothDevice = null;
let gattServer = null;
let hrCharacteristic = null;  // <-- Characteristic real del Polar
let isConnected = false;
let currentPatient = null; 
let currentMeasurements = { hr: 0, spo2: 0, pulse: 0, bpSys: 0, bpDia: 0 }; 
let simulationInterval = null;

let chartData = { labels: [], hr: [], spo2: [] };
const MAX_DATA_POINTS = 20;
let myChart = null;

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  
  // Abrir Modal al querer conectar
  btnConnect.addEventListener('click', async () => {
    if(!isConnected) {
      if (!currentPatient) {
        modalOverlay.classList.add('active'); // Pedir datos del paciente primero
      } else {
        await connectRealBluetoothDevice(); // Si ya hay paciente, ir directo a conectar
      }
    } else {
      disconnectDevice();
    }
  });

  // Manejar el registro del paciente
  patientForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Extraer datos
    currentPatient = {
      name: document.getElementById('p-name').value,
      age: document.getElementById('p-age').value,
      id: document.getElementById('p-id').value || 'Sin Expediente'
    };

    // Actualizar UI del Paciente
    displayPName.innerText = currentPatient.name;
    displayPDetails.innerText = `${currentPatient.age} años | ${currentPatient.id}`;
    avatarInitial.innerText = currentPatient.name.charAt(0).toUpperCase();

    // Mostrar Tarjeta, Esconder Modal
    patientInfoCard.classList.add('active');
    modalOverlay.classList.remove('active');

    addAlert('info', `Paciente ${currentPatient.name} registrado. Iniciando escaneo Bluetooth...`);
    
    // Iniciar Conexión Real
    await connectRealBluetoothDevice();
  });

  // Botón para guardar el registro en Base de Datos
  btnSaveRecord.addEventListener('click', () => {
    if(currentMeasurements.hr === 0) {
      alert("Aún no se reciben lecturas de la pulsera.");
      return;
    }

    addAlert('info', `✅ Registro guardado en el expediente de ${currentPatient.name}.`);
    btnSaveRecord.innerHTML = "¡Guardado exitosamente!";
    btnSaveRecord.style.backgroundColor = "#ecfdf5";
    btnSaveRecord.style.color = "#10b981";
    setTimeout(() => {
      btnSaveRecord.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        Guardar Medición Actual`;
      btnSaveRecord.style.backgroundColor = "";
      btnSaveRecord.style.color = "";
    }, 3000);
  });

  // ── Presión Arterial — Edición Manual ────────────────────────────
  const btnEditBp  = document.getElementById('btn-edit-bp');
  const bpEditForm = document.getElementById('bp-edit-form');
  const btnSaveBp  = document.getElementById('btn-save-bp');
  const bpBadge    = document.getElementById('bp-badge');
  const bpClassEl  = document.getElementById('bp-classification');

  // Toggle formulario inline
  btnEditBp.addEventListener('click', () => {
    const isOpen = bpEditForm.classList.toggle('active');
    btnEditBp.innerHTML = isOpen
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancelar`
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Ingresar`;
    if (isOpen) document.getElementById('inp-bp-sys').focus();
  });

  // Guardar y clasificar la presión ingresada
  btnSaveBp.addEventListener('click', () => {
    const sys = parseInt(document.getElementById('inp-bp-sys').value, 10);
    const dia = parseInt(document.getElementById('inp-bp-dia').value, 10);

    if (!sys || !dia || sys < 60 || dia < 40) {
      document.getElementById('inp-bp-sys').style.borderColor = 'var(--accent-red)';
      document.getElementById('inp-bp-dia').style.borderColor = 'var(--accent-red)';
      return;
    }
    document.getElementById('inp-bp-sys').style.borderColor = '';
    document.getElementById('inp-bp-dia').style.borderColor = '';

    // Guardar en estado global
    currentMeasurements.bpSys = sys;
    currentMeasurements.bpDia = dia;

    // Actualizar tarjeta principal
    document.getElementById('val-bp').innerText = `${sys}/${dia}`;

    // Clasificación ACC/AHA 2017
    const { label, cls, icon } = classifyBP(sys, dia);
    bpBadge.className   = `badge ${cls}`;
    bpBadge.innerText   = label;
    bpClassEl.innerText = `${sys}/${dia} mmHg`;

    // Log de alertas
    const alertType = cls.includes('high2') || cls.includes('crisis') ? 'critical'
                    : cls.includes('high1') || cls.includes('elevated') ? 'warning' : 'info';
    addAlert(alertType, `${icon} PA manual registrada: ${sys}/${dia} mmHg — ${label}`);

    // Actualizar gráfica con el nuevo valor
    updateCharts(currentMeasurements,
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

    // Cerrar formulario
    bpEditForm.classList.remove('active');
    btnEditBp.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Ingresar`;
  });

  // Lógica de "Monitoreo Continuo"
  // Con el Polar Verity Sense los datos llegan vía notificaciones BLE automáticamente.
  // Este botón solo muestra/oculta el estado activo en la UI.
  btnTriggerScan.addEventListener('click', async () => {
    if (!isConnected) {
      alert('⚠️ Primero debes Vincular Bluetooth a la pulsera Polar.');
      return;
    }

    if (simulationInterval) {
      // El usuario quiere pausar — detener notificaciones BLE
      clearInterval(simulationInterval);
      simulationInterval = null;
      if (hrCharacteristic) hrCharacteristic.stopNotifications().catch(() => {});
      btnTriggerScan.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg> Iniciar Monitoreo Continuo`;
      btnTriggerScan.style.backgroundColor = 'var(--accent-blue)';
      addAlert('warning', '⏸ Notificaciones BLE pausadas.');
    } else {
      // El usuario quiere reanudar — reactivar notificaciones BLE
      addAlert('info', '▶️ Activando telemetría BLE del Polar Verity Sense...');
      if (hrCharacteristic) {
        await hrCharacteristic.startNotifications().catch(err => addAlert('warning', `BLE: ${err.message}`));
      }
      simulationInterval = 1; // Bandera: indica que el monitoreo está activo
      btnTriggerScan.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pausar Monitoreo`;
      btnTriggerScan.style.backgroundColor = 'var(--text-secondary)';
    }
  });

  // Guardado de historial local
  btnSaveRecord.addEventListener('click', () => {
    if(currentMeasurements.hr === 0) {
      alert("Aún no se reciben lecturas de la pulsera."); return;
    }

    // Insertar en tabla HTML directamente
    const timeStr = new Date().toLocaleTimeString();
    const tableBody = document.getElementById('history-table-body');
    const emptyMsg = document.getElementById('empty-history-msg');
    
    if (emptyMsg) emptyMsg.style.display = 'none';

    const row = document.createElement('tr');
    row.style.borderBottom = '1px solid var(--border-light)';
    row.innerHTML = `
      <td style="padding: 12px 8px;">${timeStr}</td>
      <td style="padding: 12px 8px; font-weight: 500;">${currentPatient.name}</td>
      <td style="padding: 12px 8px; color: var(--accent-red);">${currentMeasurements.hr}</td>
      <td style="padding: 12px 8px; color: var(--accent-blue);">${currentMeasurements.spo2}%</td>
      <td style="padding: 12px 8px; color: var(--accent-orange);">${currentMeasurements.bpSys}/${currentMeasurements.bpDia}</td>
    `;
    tableBody.prepend(row);

    addAlert('info', `✅ Registro guardado en el expediente de ${currentPatient.name}.`);
    
    // Animación del botón
    btnSaveRecord.innerHTML = "¡Guardado exitosamente!";
    btnSaveRecord.style.backgroundColor = "#ecfdf5";
    btnSaveRecord.style.color = "#10b981";
    setTimeout(() => {
      btnSaveRecord.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        Guardar Medición Actual`;
      btnSaveRecord.style.backgroundColor = "";
      btnSaveRecord.style.color = "";
    }, 2000);
  });
}); // <--- FIn de DOMContentLoaded


/**
 * Función que actualiza la data y domina las simulaciones/lógica
 */
function simulateWearFitResponse() {
  // Oscilación gradual
  currentMeasurements.hr = Math.max(60, Math.min(100, (currentMeasurements.hr || 75) + (Math.floor(Math.random() * 5) - 2)));
  if(Math.random() > 0.6) currentMeasurements.spo2 = Math.max(94, Math.min(100, (currentMeasurements.spo2 || 98) + (Math.floor(Math.random() * 3) - 1)));
  currentMeasurements.pulse = currentMeasurements.hr + (Math.floor(Math.random() * 2) - 1);
  if(Math.random() > 0.7) currentMeasurements.bpSys = Math.max(110, Math.min(130, (currentMeasurements.bpSys || 120) + (Math.floor(Math.random() * 5) - 2)));
  if(Math.random() > 0.7) currentMeasurements.bpDia = Math.max(70, Math.min(85, (currentMeasurements.bpDia || 80) + (Math.floor(Math.random() * 3) - 1)));

  document.getElementById('val-hr').innerText = currentMeasurements.hr;
  document.getElementById('val-spo2').innerText = currentMeasurements.spo2;
  document.getElementById('val-pulse').innerText = currentMeasurements.pulse;
  document.getElementById('val-bp').innerText = `${currentMeasurements.bpSys}/${currentMeasurements.bpDia}`;
  document.getElementById('watch-screen-value').innerText = currentMeasurements.hr;
  document.getElementById('val-lastsync').innerText = new Date().toLocaleTimeString();

  updateCharts(currentMeasurements, new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}));
}

// ============================================
// CONEXIÓN REAL POR WEB BLUETOOTH API — POLAR VERITY SENSE
// ============================================
async function connectRealBluetoothDevice() {
  if (!navigator.bluetooth) {
    alert('❌ API Web Bluetooth no soportada. Usa Google Chrome o Microsoft Edge.');
    return;
  }
  try {
    btnConnect.innerHTML = '🔍 Buscando Polar...';
    addAlert('info', 'Escaneando dispositivos BLE cercanos...');

    // Solicitar dispositivo — filtro por nombre Polar + servicio Heart Rate estándar
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Polar' },
        { services: [0x180D] }          // Heart Rate Service UUID
      ],
      optionalServices: [
        0x180D,  // Heart Rate
        0x180F,  // Battery Level
        0x180A,  // Device Information
        'battery_service'
      ]
    });

    addAlert('info', `Dispositivo encontrado: ${bluetoothDevice.name}. Conectando GATT...`);
    btnConnect.innerHTML = '⏳ Conectando...';

    gattServer = await bluetoothDevice.gatt.connect();

    // ── Servicio Heart Rate (0x180D) ──────────────────────────────────
    const hrService = await gattServer.getPrimaryService(0x180D);

    // Characteristic Heart Rate Measurement (0x2A37)
    hrCharacteristic = await hrService.getCharacteristic(0x2A37);

    // Suscribirse a notificaciones en tiempo real
    await hrCharacteristic.startNotifications();
    hrCharacteristic.addEventListener('characteristicvaluechanged', handleHeartRateData);

    // ── Batería (opcional, no bloquea si falla) ───────────────────────
    try {
      const batService  = await gattServer.getPrimaryService(0x180F);
      const batChar     = await batService.getCharacteristic(0x2A19);
      const batValue    = await batChar.readValue();
      const battPct     = batValue.getUint8(0);
      addAlert('info', `🔋 Batería del Polar: ${battPct}%`);
    } catch (_) { /* El dispositivo puede no exponer batería */ }

    // ── Actualizar UI ─────────────────────────────────────────────────
    isConnected = true;
    btnConnect.innerHTML = `✅ Polar Conectado`;
    btnConnect.classList.add('connected');
    statusIndicator.classList.add('active');
    deviceConnectionStateText.innerText = bluetoothDevice.name || 'Polar Verity Sense';
    addAlert('info', `🟢 HR real activo. Coloca el Polar en tu brazo y presiona Iniciar Monitoreo.`);

    bluetoothDevice.addEventListener('gattserverdisconnected', disconnectDevice);

  } catch (error) {
    console.error('[BLE Error]', error);
    if (error.name === 'NotFoundError') {
      addAlert('warning', '⚠️ No se seleccionó ningún dispositivo.');
    } else if (error.name === 'SecurityError') {
      addAlert('warning', '⚠️ Permiso denegado. Asegúrate de usar HTTPS o localhost.');
    } else {
      addAlert('warning', `❌ Error BLE: ${error.message}`);
    }
    disconnectDevice();
  }
}

// ============================================
// PARSER — Heart Rate Measurement (0x2A37)
// Especificación Bluetooth SIG:
//   Byte 0 = Flags
//     bit 0 → 0: HR en Uint8 | 1: HR en Uint16
//     bit 4 → 1: RR-Intervals presentes
//   Byte 1 (o 1-2) = Heart Rate Value
// ============================================
function handleHeartRateData(event) {
  const value  = event.target.value;   // DataView
  const flags  = value.getUint8(0);
  const hrFormat16 = flags & 0x01;     // bit 0

  const hrBpm = hrFormat16
    ? value.getUint16(1, /* littleEndian= */ true)
    : value.getUint8(1);

  // Actualizar medición actual con dato real
  currentMeasurements.hr    = hrBpm;
  currentMeasurements.pulse = hrBpm;   // Pulso = FC en este sensor

  // SpO2 y BP: el Polar Verity Sense OHR NO los transmite por BLE estándar
  // Se mantienen en su último valor o en placeholder
  if (currentMeasurements.spo2 === 0) currentMeasurements.spo2 = 98;
  if (currentMeasurements.bpSys === 0) { currentMeasurements.bpSys = 120; currentMeasurements.bpDia = 80; }

  // Actualizar UI
  document.getElementById('val-hr').innerText    = hrBpm;
  document.getElementById('val-pulse').innerText  = hrBpm;
  document.getElementById('watch-screen-value').innerText = hrBpm;
  document.getElementById('val-spo2').innerText   = currentMeasurements.spo2;
  document.getElementById('val-bp').innerText     = `${currentMeasurements.bpSys}/${currentMeasurements.bpDia}`;
  document.getElementById('val-lastsync').innerText = new Date().toLocaleTimeString();

  updateCharts(currentMeasurements, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
}

function disconnectDevice() {
  // Detener notificaciones BLE si estaban activas
  if (hrCharacteristic) {
    hrCharacteristic.removeEventListener('characteristicvaluechanged', handleHeartRateData);
    if (isConnected) hrCharacteristic.stopNotifications().catch(() => {});
    hrCharacteristic = null;
  }
  if (bluetoothDevice && bluetoothDevice.gatt.connected) bluetoothDevice.gatt.disconnect();
  isConnected = false;
  if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
  btnConnect.innerHTML = 'Vincular Bluetooth';
  btnConnect.classList.remove('connected');
  statusIndicator.classList.remove('active');
  deviceConnectionStateText.innerText = 'Desconectado';
  addAlert('warning', 'Conexión BLE cerrada.');
}

let lastAlert = "";
function addAlert(type, message) {
  if (lastAlert === message) return;
  lastAlert = message;
  const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const alertEl = document.createElement('div');
  alertEl.className = `alert-item ${type}`;
  alertEl.innerHTML = `<div class="alert-time">${timeStr}</div><div class="alert-msg">${message}</div>`;
  const list = document.getElementById('alerts-list');
  list.prepend(alertEl);
  if(list.children.length > 5) list.removeChild(list.lastChild);
}

// ============================================
// GRÁFICOS INDIVIDUALES - Chart.js
// ============================================
let chartHr, chartSpo2, chartBp;
let tLabels = [], dHr = [], dSpo2 = [], dBpSys = [], dBpDia = [];

function initChart() {
  const cHr = document.getElementById('chartHr');
  const cSpo2 = document.getElementById('chartSpo2');
  const cBp = document.getElementById('chartBp');
  const sharedOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false } } };

  if(cHr) {
    chartHr = new Chart(cHr.getContext('2d'), { type: 'line', data: { labels: tLabels, datasets: [{ data: dHr, borderColor: '#ef4444', tension: 0.3, borderWidth: 2 }] }, options: sharedOpts });
  }
  if(cSpo2) {
    chartSpo2 = new Chart(cSpo2.getContext('2d'), { type: 'line', data: { labels: tLabels, datasets: [{ data: dSpo2, borderColor: '#0ea5e9', tension: 0.3, borderWidth: 2 }] }, options: sharedOpts });
  }
  if(cBp) {
    chartBp = new Chart(cBp.getContext('2d'), { type: 'line', data: { labels: tLabels, datasets: [{ data: dBpSys, borderColor: '#f97316', label: 'Sys', tension: 0.2 }, { data: dBpDia, borderColor: '#fbbf24', label: 'Dia', tension: 0.2 }] }, options: { ...sharedOpts, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: {size: 10} } } } } });
  }
}

function updateCharts(data, label) {
  if (tLabels.length >= 15) {
    tLabels.shift(); dHr.shift(); dSpo2.shift(); dBpSys.shift(); dBpDia.shift();
  }
  tLabels.push(label);
  dHr.push(data.hr);
  dSpo2.push(data.spo2);
  dBpSys.push(data.bpSys);
  dBpDia.push(data.bpDia);

  if(chartHr) chartHr.update();
  if(chartSpo2) chartSpo2.update();
  if(chartBp) chartBp.update();
}

// ============================================
// CLASIFICACIÓN DE PRESIÓN ARTERIAL
// Basado en guías ACC/AHA 2017
//   Óptima      : <120  / <80
//   Normal      : <130  / <80
//   Elevada     : 130-139 / 80-89
//   HTA Grado 1 : 140-159 / 90-99
//   HTA Grado 2 : ≥160   / ≥100
//   Crisis      : ≥180   / ≥120
// ============================================
function classifyBP(sys, dia) {
  if (sys >= 180 || dia >= 120) {
    return { label: 'Crisis Hipertensiva', cls: 'badge-bp-crisis',   icon: '🆘' };
  }
  if (sys >= 160 || dia >= 100) {
    return { label: 'HTA Grado 2',         cls: 'badge-bp-high2',   icon: '🔴' };
  }
  if (sys >= 140 || dia >= 90) {
    return { label: 'HTA Grado 1',         cls: 'badge-bp-high1',   icon: '🟠' };
  }
  if (sys >= 130 || dia >= 80) {
    return { label: 'Elevada',             cls: 'badge-bp-elevated', icon: '🟡' };
  }
  if (sys >= 120 && dia < 80) {
    return { label: 'Normal',              cls: 'badge-bp-normal',   icon: '🟢' };
  }
  return   { label: 'Óptima',             cls: 'badge-bp-optimal',  icon: '✅' };
}
