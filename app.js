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

  // Lógica de "Monitoreo Continuo"
  btnTriggerScan.addEventListener('click', async () => {
    if (!isConnected) {
      alert("⚠️ Primero debes Vincular Bluetooth a la pulsera.");
      return;
    }

    if(simulationInterval) {
      // Detener
      clearInterval(simulationInterval);
      simulationInterval = null;
      btnTriggerScan.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg> Iniciar Monitoreo Continuo`;
      btnTriggerScan.style.backgroundColor = "var(--accent-blue)";
      addAlert('warning', 'Monitoreo continuo pausado.');
    } else {
      // Iniciar
      addAlert('info', 'Enviando comando inicio (Run)... Activando telemetría.');
      btnTriggerScan.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pausar Monitoreo`;
      btnTriggerScan.style.backgroundColor = "var(--text-secondary)";

      // Simulamos la entrada CONSTANTE de datos cada 2 segundos
      simulationInterval = setInterval(() => {
        simulateWearFitResponse();
      }, 2000);
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
// CONEXIÓN REAL POR WEB BLUETOOTH API
// ============================================
async function connectRealBluetoothDevice() {
  if (!navigator.bluetooth) {
    alert("API Web Bluetooth no soportada. Usa Chrome o Edge en tu PC.");
    return;
  }
  try {
    btnConnect.innerHTML = "...Buscando BT";
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        'heart_rate', 'blood_pressure', '0000180d-0000-1000-8000-00805f9b34fb', 
        0x180D, 0x1810, 0x1822, 0xFEE7, 0xFEE0, 0xFFF0 
      ]
    });
    gattServer = await bluetoothDevice.gatt.connect();
    isConnected = true;
    btnConnect.innerHTML = `Conectado a ${bluetoothDevice.name || 'BT'}`;
    btnConnect.classList.add('connected');
    statusIndicator.classList.add('active');
    deviceConnectionStateText.innerText = bluetoothDevice.name || "KY11 Conectado";
    addAlert('info', `GATT Conectado. Preparado para iniciar sensores.`);
    bluetoothDevice.addEventListener('gattserverdisconnected', disconnectDevice);
  } catch (error) {
    console.error(error);
    disconnectDevice();
  }
}

function disconnectDevice() {
  if (bluetoothDevice && bluetoothDevice.gatt.connected) bluetoothDevice.gatt.disconnect();
  isConnected = false;
  if(simulationInterval) clearInterval(simulationInterval);
  btnConnect.innerHTML = "Vincular Bluetooth";
  btnConnect.classList.remove('connected');
  statusIndicator.classList.remove('active');
  deviceConnectionStateText.innerText = "Desconectado";
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
