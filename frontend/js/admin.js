// Configuração da API
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api' 
    : 'https://ricardo-nnnk.onrender.com/api';

// Estado da aplicação
let authToken = localStorage.getItem('admin_token');
let currentSection = 'dashboard';
let currentEditItem = null;
let dashboardData = {};

// Elementos DOM
const elements = {
    loginScreen: document.getElementById('login-screen'),
    adminDashboard: document.getElementById('admin-dashboard'),
    loginForm: document.getElementById('login-form'),
    loginBtn: document.getElementById('login-btn'),
    loginLoading: document.getElementById('login-loading'),
    loginAlert: document.getElementById('login-alert'),
    sidebar: document.getElementById('sidebar'),
    pageTitle: document.getElementById('page-title'),
    pageSubtitle: document.getElementById('page-subtitle'),
    adminUser: document.getElementById('admin-user'),
    editModal: document.getElementById('edit-modal'),
    editForm: document.getElementById('edit-form'),
    modalLoading: document.getElementById('modal-loading'),
    modalAlert: document.getElementById('modal-alert')
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Iniciando painel administrativo');
    
    initializeAdmin();
    setupEventListeners();
});

// Inicialização do admin
function initializeAdmin() {
    if (authToken) {
        // Verificar se o token ainda é válido
        verifyToken();
    } else {
        showLoginScreen();
    }
}

// Verificar validade do token
async function verifyToken() {
    try {
        const response = await fetch(`${API_BASE_URL}/admin/dashboard`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showAdminDashboard();
                loadDashboard();
            } else {
                throw new Error('Token inválido');
            }
        } else {
            throw new Error('Token inválido');
        }
    } catch (error) {
        console.log('❌ Token inválido:', error);
        logout(false);
    }
}

// Mostrar tela de login
function showLoginScreen() {
    elements.loginScreen.style.display = 'flex';
    elements.adminDashboard.style.display = 'none';
    
    // Focar no campo de usuário
    setTimeout(() => {
        document.getElementById('usuario').focus();
    }, 100);
}

// Mostrar dashboard admin
function showAdminDashboard() {
    elements.loginScreen.style.display = 'none';
    elements.adminDashboard.style.display = 'flex';
    
    // Configurar usuário logado
    const adminData = JSON.parse(localStorage.getItem('admin_data') || '{}');
    elements.adminUser.textContent = adminData.usuario || 'Administrador';
    
    // Configurar navegação
    setupNavigation();
    loadCurrentSection();
}

// Event listeners
function setupEventListeners() {
    // Login form
    elements.loginForm.addEventListener('submit', handleLogin);
    
    // Esc para fechar modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
    
    // Clique fora do modal
    elements.editModal.addEventListener('click', (e) => {
        if (e.target === elements.editModal) {
            closeModal();
        }
    });
    
    // Filtros de data
    const filterDataInicio = document.getElementById('filter-data-inicio');
    const filterDataFim = document.getElementById('filter-data-fim');
    
    if (filterDataInicio && filterDataFim) {
        // Definir datas padrão (últimos 30 dias)
        const hoje = new Date();
        const trintaDiasAtras = new Date();
        trintaDiasAtras.setDate(hoje.getDate() - 30);
        
        filterDataInicio.value = trintaDiasAtras.toISOString().split('T')[0];
        filterDataFim.value = hoje.toISOString().split('T')[0];
    }
}

// Configurar navegação lateral
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const section = link.dataset.section;
            if (section) {
                switchSection(section);
            }
        });
    });
}

// Alternar seção
function switchSection(section) {
    // Remover classe ativa de todos os links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    // Adicionar classe ativa ao link atual
    document.querySelector(`[data-section="${section}"]`).classList.add('active');
    
    // Esconder todas as seções
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.remove('active');
    });
    
    // Mostrar seção atual
    const currentSectionElement = document.getElementById(`section-${section}`);
    if (currentSectionElement) {
        currentSectionElement.classList.add('active');
    }
    
    // Atualizar título
    updatePageTitle(section);
    
    // Carregar dados da seção
    loadCurrentSection(section);
    
    currentSection = section;
}

// Atualizar título da página
function updatePageTitle(section) {
    const titles = {
        dashboard: { title: 'Dashboard', subtitle: 'Visão geral do sistema' },
        agendamentos: { title: 'Agendamentos', subtitle: 'Gerenciar agendamentos de clientes' },
        servicos: { title: 'Serviços', subtitle: 'Gerenciar serviços e preços' },
        produtos: { title: 'Produtos', subtitle: 'Controlar estoque e preços' }
    };
    
    const pageInfo = titles[section] || { title: 'Admin', subtitle: 'Painel administrativo' };
    elements.pageTitle.textContent = pageInfo.title;
    elements.pageSubtitle.textContent = pageInfo.subtitle;
}

// Carregar dados da seção atual
function loadCurrentSection(section = currentSection) {
    switch (section) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'agendamentos':
            loadAgendamentos();
            break;
        case 'servicos':
            loadServicos();
            break;
        case 'produtos':
            loadProdutos();
            break;
    }
}

// Login
async function handleLogin(e) {
    e.preventDefault();
    
    const formData = new FormData(elements.loginForm);
    const credentials = {
        usuario: formData.get('usuario').trim(),
        senha: formData.get('senha')
    };
    
    if (!credentials.usuario || !credentials.senha) {
        showLoginAlert('Por favor, preencha todos os campos.', 'error');
        return;
    }
    
    console.log('🔐 Tentando login para:', credentials.usuario);
    
    // Mostrar loading
    elements.loginLoading.classList.add('active');
    elements.loginBtn.disabled = true;
    elements.loginBtn.textContent = 'Entrando...';
    
    try {
        const response = await fetch(`${API_BASE_URL}/admin/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(credentials)
        });
        
        const result = await response.json();
        
        if (result.success) {
            authToken = result.token;
            localStorage.setItem('admin_token', authToken);
            localStorage.setItem('admin_data', JSON.stringify(result.admin));
            
            showLoginAlert('✅ Login realizado com sucesso!', 'success');
            
            setTimeout(() => {
                showAdminDashboard();
                loadDashboard();
            }, 1000);
            
            console.log('✅ Login bem-sucedido');
        } else {
            throw new Error(result.message || 'Erro no login');
        }
        
    } catch (error) {
        console.error('❌ Erro no login:', error);
        showLoginAlert(`❌ ${error.message}`, 'error');
    } finally {
        // Esconder loading
        elements.loginLoading.classList.remove('active');
        elements.loginBtn.disabled = false;
        elements.loginBtn.textContent = 'Entrar';
    }
}

// Logout
function logout(showMessage = true) {
    authToken = null;
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_data');
    
    if (showMessage) {
        showLoginAlert('✅ Logout realizado com sucesso.', 'success');
    }
    
    showLoginScreen();
    console.log('👋 Logout realizado');
}

// Carregar dashboard
async function loadDashboard() {
    try {
        console.log('📊 Carregando dashboard...');
        
        const response = await fetch(`${API_BASE_URL}/admin/dashboard`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            dashboardData = result.dashboard;
            updateDashboardCards();
            updateProximosAgendamentos();
            console.log('✅ Dashboard carregado');
        } else {
            throw new Error(result.message || 'Erro ao carregar dashboard');
        }
        
    } catch (error) {
        console.error('❌ Erro ao carregar dashboard:', error);
        showAlert('Erro ao carregar dados do dashboard.', 'error');
    }
}

// Atualizar cards do dashboard
function updateDashboardCards() {
    document.getElementById('agendamentos-hoje').textContent = dashboardData.agendamentos_hoje || 0;
    document.getElementById('agendamentos-mes').textContent = dashboardData.agendamentos_mes || 0;
    
    // Contador de serviços ativos (será atualizado quando carregar serviços)
    document.getElementById('servicos-ativos').textContent = '-';
    
    // Contador de produtos com estoque baixo (será atualizado quando carregar produtos)
    document.getElementById('produtos-estoque-baixo').textContent = '-';
}

// Atualizar próximos agendamentos
function updateProximosAgendamentos() {
    const tbody = document.getElementById('proximos-agendamentos');
    
    if (!dashboardData.proximos_agendamentos || dashboardData.proximos_agendamentos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state" style="padding: 2rem;">
                    <div class="icon">📅</div>
                    <h3>Nenhum agendamento próximo</h3>
                    <p>Não há agendamentos nos próximos dias.</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = dashboardData.proximos_agendamentos.map(agendamento => `
        <tr>
            <td>${agendamento.nome_cliente}</td>
            <td>${agendamento.nome_servico || 'N/A'}</td>
            <td>${formatDate(agendamento.data)}</td>
            <td>${formatTime(agendamento.horario)}</td>
            <td>${agendamento.telefone}</td>
        </tr>
    `).join('');
}

// Carregar agendamentos
async function loadAgendamentos() {
    try {
        console.log('📅 Carregando agendamentos...');
        
        const tbody = document.getElementById('agendamentos-table');
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="table-loading">
                    <div class="spinner"></div>
                    Carregando agendamentos...
                </td>
            </tr>
        `;
        
        // Obter filtros
        const params = new URLSearchParams();
        const dataInicio = document.getElementById('filter-data-inicio')?.value;
        const dataFim = document.getElementById('filter-data-fim')?.value;
        const status = document.getElementById('filter-status')?.value;
        
        if (dataInicio) params.append('data_inicio', dataInicio);
        if (dataFim) params.append('data_fim', dataFim);
        if (status) params.append('status', status);
        
        const response = await fetch(`${API_BASE_URL}/admin/agendamentos?${params}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            displayAgendamentos(result.agendamentos);
            console.log('✅ Agendamentos carregados:', result.agendamentos.length);
        } else {
            throw new Error(result.message || 'Erro ao carregar agendamentos');
        }
        
    } catch (error) {
        console.error('❌ Erro ao carregar agendamentos:', error);
        const tbody = document.getElementById('agendamentos-table');
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state" style="padding: 2rem;">
                    <div class="icon">❌</div>
                    <h3>Erro ao carregar agendamentos</h3>
                    <p>${error.message}</p>
                    <button onclick="loadAgendamentos()" class="btn btn-primary" style="margin-top: 1rem;">
                        Tentar Novamente
                    </button>
                </td>
            </tr>
        `;
    }
}

// Exibir agendamentos
function displayAgendamentos(agendamentos) {
    const tbody = document.getElementById('agendamentos-table');
    
    if (agendamentos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state" style="padding: 2rem;">
                    <div class="icon">📅</div>
                    <h3>Nenhum agendamento encontrado</h3>
                    <p>Não há agendamentos para os filtros selecionados.</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = agendamentos.map(agendamento => `
        <tr>
            <td>#${agendamento.id}</td>
            <td>${agendamento.nome_cliente}</td>
            <td>${agendamento.telefone}</td>
            <td>${agendamento.nome_servico || 'N/A'}</td>
            <td>${formatDate(agendamento.data)}</td>
            <td>${formatTime(agendamento.horario)}</td>
            <td>
                <span class="status-badge status-${agendamento.status}">
                    ${getStatusText(agendamento.status)}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    ${agendamento.status === 'agendado' ? `
                        <button class="btn btn-success btn-sm" onclick="updateAgendamentoStatus(${agendamento.id}, 'concluido')" title="Marcar como concluído">
                            ✅
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="updateAgendamentoStatus(${agendamento.id}, 'cancelado')" title="Cancelar agendamento">
                            ❌
                        </button>
                    ` : ''}
                    ${agendamento.status === 'cancelado' ? `
                        <button class="btn btn-info btn-sm" onclick="updateAgendamentoStatus(${agendamento.id}, 'agendado')" title="Reagendar">
                            🔄
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

// Atualizar status do agendamento
async function updateAgendamentoStatus(id, newStatus) {
    const confirmMessages = {
        concluido: 'Marcar este agendamento como concluído?',
        cancelado: 'Cancelar este agendamento?',
        agendado: 'Reagendar este agendamento?'
    };
    
    if (!confirm(confirmMessages[newStatus])) {
        return;
    }
    
    try {
        console.log(`🔄 Atualizando status do agendamento ${id} para ${newStatus}...`);
        
        const response = await fetch(`${API_BASE_URL}/admin/agendamentos/${id}/status`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showAlert('✅ Status atualizado com sucesso!', 'success');
            loadAgendamentos(); // Recarregar lista
            
            // Atualizar dashboard se necessário
            if (currentSection === 'dashboard') {
                loadDashboard();
            }
            
            console.log('✅ Status atualizado');
        } else {
            throw new Error(result.message || 'Erro ao atualizar status');
        }
        
    } catch (error) {
        console.error('❌ Erro ao atualizar status:', error);
        showAlert(`❌ ${error.message}`, 'error');
    }
}

// Carregar serviços
async function loadServicos() {
    try {
        console.log('✂️ Carregando serviços...');
        
        const tbody = document.getElementById('servicos-table');
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="table-loading">
                    <div class="spinner"></div>
                    Carregando serviços...
                </td>
            </tr>
        `;
        
        const response = await fetch(`${API_BASE_URL}/admin/servicos`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            displayServicos(result.servicos);
            
            // Atualizar contador no dashboard
            const servicosAtivos = result.servicos.filter(s => s.ativo).length;
            document.getElementById('servicos-ativos').textContent = servicosAtivos;
            
            console.log('✅ Serviços carregados:', result.servicos.length);
        } else {
            throw new Error(result.message || 'Erro ao carregar serviços');
        }
        
    } catch (error) {
        console.error('❌ Erro ao carregar serviços:', error);
        const tbody = document.getElementById('servicos-table');
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state" style="padding: 2rem;">
                    <div class="icon">❌</div>
                    <h3>Erro ao carregar serviços</h3>
                    <p>${error.message}</p>
                    <button onclick="loadServicos()" class="btn btn-primary" style="margin-top: 1rem;">
                        Tentar Novamente
                    </button>
                </td>
            </tr>
        `;
    }
}

// Exibir serviços
function displayServicos(servicos) {
    const tbody = document.getElementById('servicos-table');
    
    if (servicos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state" style="padding: 2rem;">
                    <div class="icon">✂️</div>
                    <h3>Nenhum serviço encontrado</h3>
                    <p>Não há serviços cadastrados no sistema.</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = servicos.map(servico => `
        <tr>
            <td>#${servico.id}</td>
            <td>${servico.nome_servico}</td>
            <td>R$ ${parseFloat(servico.preco).toFixed(2)}</td>
            <td>${servico.duracao || 60}min</td>
            <td>
                <span class="status-badge status-${servico.ativo ? 'agendado' : 'cancelado'}">
                    ${servico.ativo ? 'Ativo' : 'Inativo'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-info btn-sm" onclick="editServico(${servico.id})" title="Editar serviço">
                        ✏️ Editar
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Editar serviço
async function editServico(id) {
    try {
        // Encontrar o serviço pelos dados já carregados
        const response = await fetch(`${API_BASE_URL}/admin/servicos`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        const servico = result.servicos.find(s => s.id === id);
        
        if (!servico) {
            throw new Error('Serviço não encontrado');
        }
        
        openEditModal('Editar Serviço', 'servico', servico);
        
    } catch (error) {
        console.error('❌ Erro ao carregar serviço:', error);
        showAlert(`❌ ${error.message}`, 'error');
    }
}

// Carregar produtos
async function loadProdutos() {
    try {
        console.log('🛍️ Carregando produtos...');
        
        const tbody = document.getElementById('produtos-table');
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="table-loading">
                    <div class="spinner"></div>
                    Carregando produtos...
                </td>
            </tr>
        `;
        
        const response = await fetch(`${API_BASE_URL}/admin/produtos`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            displayProdutos(result.produtos);
            
            // Atualizar contador de estoque baixo no dashboard
            const produtosEstoqueBaixo = result.produtos.filter(p => p.estoque <= 5 && p.ativo).length;
            document.getElementById('produtos-estoque-baixo').textContent = produtosEstoqueBaixo;
            
            console.log('✅ Produtos carregados:', result.produtos.length);
        } else {
            throw new Error(result.message || 'Erro ao carregar produtos');
        }
        
    } catch (error) {
        console.error('❌ Erro ao carregar produtos:', error);
        const tbody = document.getElementById('produtos-table');
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state" style="padding: 2rem;">
                    <div class="icon">❌</div>
                    <h3>Erro ao carregar produtos</h3>
                    <p>${error.message}</p>
                    <button onclick="loadProdutos()" class="btn btn-primary" style="margin-top: 1rem;">
                        Tentar Novamente
                    </button>
                </td>
            </tr>
        `;
    }
}

// Exibir produtos
function displayProdutos(produtos) {
    const tbody = document.getElementById('produtos-table');
    
    if (produtos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state" style="padding: 2rem;">
                    <div class="icon">🛍️</div>
                    <h3>Nenhum produto encontrado</h3>
                    <p>Não há produtos cadastrados no sistema.</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = produtos.map(produto => `
        <tr ${produto.estoque <= 5 && produto.ativo ? 'style="background: rgba(244, 67, 54, 0.05);"' : ''}>
            <td>#${produto.id}</td>
            <td>
                ${produto.nome_produto}
                ${produto.estoque <= 5 && produto.ativo ? '<span style="color: #f44336; font-size: 0.8rem;"> ⚠️ Estoque baixo</span>' : ''}
            </td>
            <td>
                <span ${produto.estoque <= 5 && produto.ativo ? 'style="color: #f44336; font-weight: bold;"' : ''}>
                    ${produto.estoque}
                </span>
            </td>
            <td>R$ ${parseFloat(produto.preco).toFixed(2)}</td>
            <td>
                <span class="status-badge status-${produto.ativo ? 'agendado' : 'cancelado'}">
                    ${produto.ativo ? 'Ativo' : 'Inativo'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-info btn-sm" onclick="editProduto(${produto.id})" title="Editar produto">
                        ✏️ Editar
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Editar produto
async function editProduto(id) {
    try {
        // Encontrar o produto pelos dados já carregados
        const response = await fetch(`${API_BASE_URL}/admin/produtos`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        const produto = result.produtos.find(p => p.id === id);
        
        if (!produto) {
            throw new Error('Produto não encontrado');
        }
        
        openEditModal('Editar Produto', 'produto', produto);
        
    } catch (error) {
        console.error('❌ Erro ao carregar produto:', error);
        showAlert(`❌ ${error.message}`, 'error');
    }
}

// Abrir modal de edição
function openEditModal(title, type, item) {
    document.getElementById('modal-title').textContent = title;
    currentEditItem = { type, item };
    
    // Criar campos do formulário baseado no tipo
    const formFields = document.getElementById('form-fields');
    
    if (type === 'servico') {
        formFields.innerHTML = `
            <div class="form-grid">
                <div class="form-group">
                    <label for="edit-nome_servico">Nome do Serviço *</label>
                    <input type="text" id="edit-nome_servico" value="${item.nome_servico}" required maxlength="100">
                </div>
                <div class="form-group">
                    <label for="edit-preco">Preço (R$) *</label>
                    <input type="number" id="edit-preco" value="${item.preco}" step="0.01" min="0" required>
                </div>
                <div class="form-group">
                    <label for="edit-duracao">Duração (minutos) *</label>
                    <input type="number" id="edit-duracao" value="${item.duracao || 60}" min="1" required>
                </div>
                <div class="form-group">
                    <label for="edit-ativo">Status *</label>
                    <select id="edit-ativo" required>
                        <option value="true" ${item.ativo ? 'selected' : ''}>Ativo</option>
                        <option value="false" ${!item.ativo ? 'selected' : ''}>Inativo</option>
                    </select>
                </div>
            </div>
        `;
    } else if (type === 'produto') {
        formFields.innerHTML = `
            <div class="form-grid">
                <div class="form-group">
                    <label for="edit-nome_produto">Nome do Produto *</label>
                    <input type="text" id="edit-nome_produto" value="${item.nome_produto}" required maxlength="100">
                </div>
                <div class="form-group">
                    <label for="edit-estoque">Estoque *</label>
                    <input type="number" id="edit-estoque" value="${item.estoque}" min="0" required>
                </div>
                <div class="form-group">
                    <label for="edit-preco">Preço (R$) *</label>
                    <input type="number" id="edit-preco" value="${item.preco}" step="0.01" min="0" required>
                </div>
                <div class="form-group">
                    <label for="edit-ativo">Status *</label>
                    <select id="edit-ativo" required>
                        <option value="true" ${item.ativo ? 'selected' : ''}>Ativo</option>
                        <option value="false" ${!item.ativo ? 'selected' : ''}>Inativo</option>
                    </select>
                </div>
            </div>
        `;
    }
    
    elements.editModal.classList.add('active');
    
    // Focar no primeiro campo
    setTimeout(() => {
        const firstInput = formFields.querySelector('input, select');
        if (firstInput) firstInput.focus();
    }, 100);
}

// Fechar modal
function closeModal() {
    elements.editModal.classList.remove('active');
    currentEditItem = null;
    elements.modalAlert.innerHTML = '';
    elements.editForm.reset();
}

// Toggle sidebar mobile
function toggleSidebar() {
    elements.sidebar.classList.toggle('mobile-visible');
}

// Submit do formulário de edição
elements.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentEditItem) return;
    
    const { type, item } = currentEditItem;
    
    // Coletar dados do formulário
    const formData = {};
    const inputs = elements.editForm.querySelectorAll('input, select');
    
    inputs.forEach(input => {
        const key = input.id.replace('edit-', '');
        let value = input.value;
        
        // Converter tipos apropriados
        if (input.type === 'number') {
            value = parseFloat(value);
        } else if (key === 'ativo') {
            value = value === 'true';
        }
        
        formData[key] = value;
    });
    
    console.log(`💾 Salvando ${type}:`, formData);
    
    // Mostrar loading
    elements.modalLoading.classList.add('active');
    const submitBtn = elements.editForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = '💾 Salvando...';
    
    try {
        const endpoint = type === 'servico' ? 'servicos' : 'produtos';
        
        const response = await fetch(`${API_BASE_URL}/admin/${endpoint}/${item.id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showModalAlert('✅ Alterações salvas com sucesso!', 'success');
            
            // Recarregar dados da seção
            setTimeout(() => {
                closeModal();
                loadCurrentSection();
            }, 1500);
            
            console.log('✅ Item atualizado');
        } else {
            throw new Error(result.message || 'Erro ao salvar alterações');
        }
        
    } catch (error) {
        console.error('❌ Erro ao salvar:', error);
        showModalAlert(`❌ ${error.message}`, 'error');
    } finally {
        // Esconder loading
        elements.modalLoading.classList.remove('active');
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Salvar';
    }
});

// Funções utilitárias
function formatDate(dateString) {
    return new Date(dateString + 'T00:00:00').toLocaleDateString('pt-BR');
}

function formatTime(timeString) {
    return timeString.substring(0, 5);
}

function getStatusText(status) {
    const statusTexts = {
        agendado: 'Agendado',
        concluido: 'Concluído',
        cancelado: 'Cancelado'
    };
    return statusTexts[status] || status;
}

function showAlert(message, type = 'info') {
    // Implementar sistema de alertas globais se necessário
    alert(message);
}

function showLoginAlert(message, type = 'info') {
    const alertElement = document.createElement('div');
    alertElement.className = `alert alert-${type}`;
    alertElement.textContent = message;
    
    elements.loginAlert.innerHTML = '';
    elements.loginAlert.appendChild(alertElement);
    
    setTimeout(() => {
        alertElement.classList.add('show');
    }, 100);
    
    if (type !== 'error') {
        setTimeout(() => {
            alertElement.classList.remove('show');
            setTimeout(() => {
                if (alertElement.parentNode) {
                    alertElement.remove();
                }
            }, 300);
        }, 3000);
    }
}

function showModalAlert(message, type = 'info') {
    const alertElement = document.createElement('div');
    alertElement.className = `alert alert-${type}`;
    alertElement.textContent = message;
    
    elements.modalAlert.innerHTML = '';
    elements.modalAlert.appendChild(alertElement);
    
    setTimeout(() => {
        alertElement.classList.add('show');
    }, 100);
}

// Log de inicialização
console.log('✅ Script admin carregado com sucesso');
console.log('🔗 API Base URL:', API_BASE_URL);