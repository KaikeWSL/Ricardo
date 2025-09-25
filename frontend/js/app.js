// Configuração da API
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api' 
    : 'https://SEU-BACKEND-URL.onrender.com/api';

// Estado da aplicação
let servicos = [];
let selectedService = null;
let selectedTime = null;

// Elementos DOM
const elements = {
    servicesList: document.getElementById('services-list'),
    servicoSelect: document.getElementById('servico_id'),
    dataInput: document.getElementById('data'),
    timeSlotsContainer: document.getElementById('time-slots'),
    horarioInput: document.getElementById('horario'),
    bookingForm: document.getElementById('booking-form'),
    submitBtn: document.getElementById('submit-btn'),
    bookingLoading: document.getElementById('booking-loading'),
    alertContainer: document.getElementById('alert-container'),
    telefoneInput: document.getElementById('telefone')
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Iniciando aplicação Ricardo Cabelereiro');
    
    initializeApp();
    setupEventListeners();
    setupNavigation();
    setMinDate();
});

// Configurações iniciais
function initializeApp() {
    loadServices();
    setupPhoneMask();
}

// Configurar navegação suave
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                targetElement.scrollIntoView({ 
                    behavior: 'smooth',
                    block: 'start'
                });
                
                // Atualizar link ativo
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            }
        });
    });
}

// Configurar data mínima (hoje)
function setMinDate() {
    const today = new Date().toISOString().split('T')[0];
    elements.dataInput.min = today;
    
    // Definir data máxima (30 dias a partir de hoje)
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 30);
    elements.dataInput.max = maxDate.toISOString().split('T')[0];
}

// Máscara para telefone
function setupPhoneMask() {
    elements.telefoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        
        if (value.length <= 11) {
            value = value.replace(/(\d{2})(\d)/, '($1) $2');
            value = value.replace(/(\d{4,5})(\d{4})$/, '$1-$2');
        }
        
        e.target.value = value;
    });
    
    elements.telefoneInput.addEventListener('keypress', (e) => {
        if (!/\d/.test(e.key) && !['Backspace', 'Delete', 'Tab', 'Escape', 'Enter'].includes(e.key)) {
            e.preventDefault();
        }
    });
}

// Event listeners
function setupEventListeners() {
    // Mudança de data
    elements.dataInput.addEventListener('change', () => {
        const selectedDate = elements.dataInput.value;
        if (selectedDate) {
            loadAvailableTimes(selectedDate);
        }
    });
    
    // Submit do formulário
    elements.bookingForm.addEventListener('submit', handleFormSubmit);
    
    // Mudança de serviço
    elements.servicoSelect.addEventListener('change', (e) => {
        selectedService = e.target.value;
        highlightSelectedService();
    });
}

// Carregar serviços
async function loadServices() {
    try {
        console.log('📥 Carregando serviços...');
        const response = await fetch(`${API_BASE_URL}/servicos`);
        const data = await response.json();
        
        if (data.success) {
            servicos = data.servicos;
            displayServices();
            populateServiceSelect();
            console.log('✅ Serviços carregados:', servicos.length);
        } else {
            throw new Error(data.message || 'Erro ao carregar serviços');
        }
    } catch (error) {
        console.error('❌ Erro ao carregar serviços:', error);
        showAlert('Erro ao carregar serviços. Tente recarregar a página.', 'error');
        
        // Fallback - mostrar mensagem de erro
        elements.servicesList.innerHTML = `
            <div style="text-align: center; color: #666; padding: 2rem;">
                <p>Erro ao carregar serviços.</p>
                <button onclick="loadServices()" class="btn btn-secondary" style="margin-top: 1rem;">
                    Tentar Novamente
                </button>
            </div>
        `;
    }
}

// Exibir serviços na grade
function displayServices() {
    if (servicos.length === 0) {
        elements.servicesList.innerHTML = '<p style="text-align: center; color: #666;">Nenhum serviço disponível no momento.</p>';
        return;
    }
    
    elements.servicesList.innerHTML = servicos.map(servico => `
        <div class="service-item" data-service-id="${servico.id}" onclick="selectService(${servico.id})">
            <h4>${servico.nome_servico}</h4>
            <div class="service-price">R$ ${parseFloat(servico.preco).toFixed(2)}</div>
            <div class="service-duration">${servico.duracao || 60} minutos</div>
        </div>
    `).join('');
}

// Selecionar serviço
function selectService(serviceId) {
    selectedService = serviceId;
    elements.servicoSelect.value = serviceId;
    highlightSelectedService();
    
    // Scroll suave para o formulário
    document.getElementById('agendamento').scrollIntoView({ 
        behavior: 'smooth',
        block: 'center'
    });
}

// Destacar serviço selecionado
function highlightSelectedService() {
    document.querySelectorAll('.service-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    if (selectedService) {
        const selectedItem = document.querySelector(`[data-service-id="${selectedService}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }
    }
}

// Popular select de serviços
function populateServiceSelect() {
    elements.servicoSelect.innerHTML = '<option value="">Selecione um serviço</option>';
    
    servicos.forEach(servico => {
        const option = document.createElement('option');
        option.value = servico.id;
        option.textContent = `${servico.nome_servico} - R$ ${parseFloat(servico.preco).toFixed(2)}`;
        elements.servicoSelect.appendChild(option);
    });
}

// Carregar horários disponíveis
async function loadAvailableTimes(date) {
    try {
        console.log('⏰ Carregando horários para:', date);
        elements.timeSlotsContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 1rem;">
                <div class="spinner"></div>
                <p style="margin-top: 0.5rem; color: #666;">Carregando horários...</p>
            </div>
        `;
        
        const response = await fetch(`${API_BASE_URL}/horarios-disponiveis/${date}`);
        const data = await response.json();
        
        if (data.success) {
            displayAvailableTimes(data.horarios_disponiveis);
            console.log('✅ Horários carregados:', data.horarios_disponiveis.length);
        } else {
            throw new Error(data.message || 'Erro ao carregar horários');
        }
    } catch (error) {
        console.error('❌ Erro ao carregar horários:', error);
        elements.timeSlotsContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 1rem; color: #666;">
                <p>Erro ao carregar horários disponíveis.</p>
                <button onclick="loadAvailableTimes('${date}')" class="btn btn-secondary" style="margin-top: 0.5rem; font-size: 0.9rem; padding: 0.5rem 1rem;">
                    Tentar Novamente
                </button>
            </div>
        `;
    }
}

// Exibir horários disponíveis
function displayAvailableTimes(availableTimes) {
    if (availableTimes.length === 0) {
        elements.timeSlotsContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 1rem; color: #666;">
                <p>Nenhum horário disponível para esta data.</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Tente escolher outra data.</p>
            </div>
        `;
        return;
    }
    
    elements.timeSlotsContainer.innerHTML = availableTimes.map(time => `
        <div class="time-slot" onclick="selectTime('${time}')">
            ${time}
        </div>
    `).join('');
    
    // Limpar seleção anterior
    selectedTime = null;
    elements.horarioInput.value = '';
}

// Selecionar horário
function selectTime(time) {
    selectedTime = time;
    elements.horarioInput.value = time;
    
    // Remover seleção anterior
    document.querySelectorAll('.time-slot').forEach(slot => {
        slot.classList.remove('selected');
    });
    
    // Selecionar novo horário
    event.target.classList.add('selected');
    
    console.log('⏰ Horário selecionado:', time);
}

// Lidar com envio do formulário
async function handleFormSubmit(e) {
    e.preventDefault();
    
    if (!validateForm()) {
        return;
    }
    
    const formData = {
        nome_cliente: document.getElementById('nome_cliente').value.trim(),
        telefone: document.getElementById('telefone').value.trim(),
        data: document.getElementById('data').value,
        horario: elements.horarioInput.value,
        servico_id: parseInt(elements.servicoSelect.value),
        observacoes: document.getElementById('observacoes').value.trim() || null
    };
    
    console.log('📝 Enviando agendamento:', formData);
    
    // Mostrar loading
    elements.bookingLoading.classList.add('active');
    elements.submitBtn.disabled = true;
    elements.submitBtn.textContent = 'Processando...';
    
    try {
        const response = await fetch(`${API_BASE_URL}/agendar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showAlert('✅ Agendamento realizado com sucesso! Em breve entraremos em contato para confirmar.', 'success');
            resetForm();
            console.log('✅ Agendamento criado:', result.agendamento);
        } else {
            throw new Error(result.message || 'Erro ao realizar agendamento');
        }
        
    } catch (error) {
        console.error('❌ Erro no agendamento:', error);
        showAlert(`❌ Erro: ${error.message}`, 'error');
    } finally {
        // Esconder loading
        elements.bookingLoading.classList.remove('active');
        elements.submitBtn.disabled = false;
        elements.submitBtn.textContent = 'Confirmar Agendamento';
    }
}

// Validar formulário
function validateForm() {
    const nome = document.getElementById('nome_cliente').value.trim();
    const telefone = document.getElementById('telefone').value.trim();
    const data = document.getElementById('data').value;
    const servicoId = elements.servicoSelect.value;
    const horario = elements.horarioInput.value;
    
    if (!nome) {
        showAlert('Por favor, digite seu nome completo.', 'error');
        document.getElementById('nome_cliente').focus();
        return false;
    }
    
    if (nome.length < 2) {
        showAlert('Nome deve ter pelo menos 2 caracteres.', 'error');
        document.getElementById('nome_cliente').focus();
        return false;
    }
    
    if (!telefone || !telefone.match(/^\(\d{2}\)\s\d{4,5}-\d{4}$/)) {
        showAlert('Por favor, digite um telefone válido no formato (11) 99999-9999.', 'error');
        elements.telefoneInput.focus();
        return false;
    }
    
    if (!data) {
        showAlert('Por favor, selecione uma data.', 'error');
        elements.dataInput.focus();
        return false;
    }
    
    // Verificar se a data não é no passado
    const selectedDate = new Date(data + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
        showAlert('Não é possível agendar para datas passadas.', 'error');
        elements.dataInput.focus();
        return false;
    }
    
    if (!servicoId) {
        showAlert('Por favor, selecione um serviço.', 'error');
        elements.servicoSelect.focus();
        return false;
    }
    
    if (!horario) {
        showAlert('Por favor, selecione um horário.', 'error');
        return false;
    }
    
    return true;
}

// Resetar formulário
function resetForm() {
    elements.bookingForm.reset();
    selectedService = null;
    selectedTime = null;
    elements.horarioInput.value = '';
    
    // Limpar seleções visuais
    document.querySelectorAll('.service-item.selected').forEach(item => {
        item.classList.remove('selected');
    });
    
    document.querySelectorAll('.time-slot.selected').forEach(slot => {
        slot.classList.remove('selected');
    });
    
    // Limpar horários
    elements.timeSlotsContainer.innerHTML = `
        <p style="text-align: center; color: #666; grid-column: 1 / -1; padding: 1rem;">
            Selecione uma data para ver os horários disponíveis
        </p>
    `;
    
    // Resetar data mínima
    setMinDate();
}

// Mostrar alerta
function showAlert(message, type = 'info') {
    const alertElement = document.createElement('div');
    alertElement.className = `alert alert-${type}`;
    alertElement.textContent = message;
    
    elements.alertContainer.innerHTML = '';
    elements.alertContainer.appendChild(alertElement);
    
    // Mostrar com animação
    setTimeout(() => {
        alertElement.classList.add('show');
    }, 100);
    
    // Auto-remover após 5 segundos (exceto erros críticos)
    if (type !== 'error' || !message.includes('Erro interno')) {
        setTimeout(() => {
            alertElement.classList.remove('show');
            setTimeout(() => {
                if (alertElement.parentNode) {
                    alertElement.remove();
                }
            }, 300);
        }, 5000);
    }
    
    // Scroll para o alerta
    alertElement.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
    });
}

// Utilitários
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

function formatTime(time) {
    return time.substring(0, 5);
}

// Tratamento de erros globais
window.addEventListener('error', (e) => {
    console.error('❌ Erro global:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('❌ Promise rejeitada:', e.reason);
});

// Log de inicialização
console.log('✅ Script carregado com sucesso');
console.log('🔗 API Base URL:', API_BASE_URL);