const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const SecuritySetup = require('./security-setup');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const securitySetup = new SecuritySetup();

// Configurar trust proxy para Render.com
app.set('trust proxy', true);

// Importar rotas
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const servicosRoutes = require('./routes/servicos');

// Middleware de segurança
app.use(helmet());

// Configurar CORS - Permitir múltiplas origens
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'ricardocabelereiro.netlify.app',
  'https://ricardo-cabelereiro-cbj9.onrender.com'
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir requests sem origin (ex: Postman, mobile apps)
    if (!origin) return callback(null, true);
    
    // Permitir qualquer origem em desenvolvimento
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // Em produção, verificar lista de origens permitidas
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Para outras origens, permitir também (temporário para resolver CORS)
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP por janela
  message: {
    success: false,
    message: 'Muitas tentativas. Tente novamente em 15 minutos.'
  }
});

// Rate limiting mais restrito para login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // máximo 5 tentativas de login por IP
  message: {
    success: false,
    message: 'Muitas tentativas de login. Tente novamente em 15 minutos.'
  }
});

app.use(limiter);

// Middleware para parsing JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware para logs
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Servir arquivos estáticos do frontend
app.use(express.static('../frontend'));

// ===== ENDPOINTS DE SEGURANÇA =====

// Verificar status de inicialização do sistema
app.get('/api/security/status', async (req, res) => {
  try {
    const report = await securitySetup.getSecurityReport();
    res.json({
      success: true,
      ...report
    });
  } catch (error) {
    console.error('Erro ao obter status de segurança:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar status de segurança'
    });
  }
});

// Configuração inicial do sistema (apenas se não há admins)
app.post('/api/security/setup', async (req, res) => {
  try {
    const { usuario, senha, confirmacao } = req.body;

    // Validações básicas
    if (!usuario || !senha || !confirmacao) {
      return res.status(400).json({
        success: false,
        message: 'Usuário, senha e confirmação são obrigatórios'
      });
    }

    if (senha !== confirmacao) {
      return res.status(400).json({
        success: false,
        message: 'Senha e confirmação não coincidem'
      });
    }

    // Verificar se já existe admin
    const hasAdmins = await securitySetup.hasAdminUsers();
    if (hasAdmins) {
      return res.status(403).json({
        success: false,
        message: 'Sistema já foi inicializado'
      });
    }

    // Criar primeiro admin
    await securitySetup.createFirstAdmin(usuario, senha);

    // Limpar arquivos inseguros
    await securitySetup.cleanupInsecureFiles();

    res.json({
      success: true,
      message: 'Sistema inicializado com sucesso',
      usuario: usuario
    });

  } catch (error) {
    console.error('Erro na configuração inicial:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Alterar senha (autenticado)
app.post('/api/security/change-password', async (req, res) => {
  try {
    const { usuario, senhaAtual, novaSenha, confirmacao } = req.body;

    if (!usuario || !senhaAtual || !novaSenha || !confirmacao) {
      return res.status(400).json({
        success: false,
        message: 'Todos os campos são obrigatórios'
      });
    }

    if (novaSenha !== confirmacao) {
      return res.status(400).json({
        success: false,
        message: 'Nova senha e confirmação não coincidem'
      });
    }

    await securitySetup.updateAdminPassword(usuario, senhaAtual, novaSenha);

    res.json({
      success: true,
      message: 'Senha alterada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Gerar nova chave JWT
app.post('/api/security/generate-jwt', async (req, res) => {
  try {
    const newSecret = securitySetup.generateJWTSecret();
    
    res.json({
      success: true,
      message: 'Nova chave JWT gerada',
      jwt_secret: newSecret,
      instructions: 'Adicione esta chave ao arquivo .env como JWT_SECRET e reinicie o servidor'
    });

  } catch (error) {
    console.error('Erro ao gerar JWT:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao gerar nova chave JWT'
    });
  }
});

// Rota de saúde
app.get('/health', async (req, res) => {
  try {
    // Testar conexão com banco
    const pool = require('./config/database');
    const dbTest = await pool.query('SELECT 1 as test');
    
    // Testar se tabela servicos existe
    let servicosTest = null;
    try {
      const servicosResult = await pool.query('SELECT COUNT(*) as total FROM servicos');
      servicosTest = `${servicosResult.rows[0].total} serviços encontrados`;
    } catch (tableError) {
      servicosTest = `Erro: ${tableError.message}`;
    }
    
    res.json({
      success: true,
      message: 'Servidor funcionando normalmente',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      database: 'Conectado',
      dbTest: dbTest.rows[0],
      servicosTable: servicosTest,
      env: {
        database_url_exists: !!process.env.DATABASE_URL,
        node_env: process.env.NODE_ENV,
        jwt_secret_exists: !!process.env.JWT_SECRET
      }
    });
  } catch (error) {
    console.error('❌ Erro no health check:', error);
    res.status(500).json({
      success: false,
      message: 'Erro de conexão com banco de dados',
      timestamp: new Date().toISOString(),
      error: error.message,
      errorDetails: error.stack
    });
  }
});

// Aplicar rate limiting específico para login
app.use('/api/admin/login', loginLimiter);

// Rotas da API
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', servicosRoutes);

// Rota específica para admin
app.get('/admin', (req, res) => {
  res.sendFile('admin.html', { root: '../frontend' });
});

// Rota catch-all para SPA (Single Page Application) - deve vir por último
app.get('*', (req, res) => {
  // Se for uma rota da API que não existe, retornar 404 JSON
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      success: false,
      message: 'Endpoint não encontrado'
    });
  }
  
  // Para outras rotas, servir o index.html
  res.sendFile('index.html', { root: '../frontend' });
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  console.error('Erro não tratado:', error);
  
  res.status(500).json({
    success: false,
    message: 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { error: error.message })
  });
});

// Middleware para rotas não encontradas
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint não encontrado'
  });
});

// Inicializar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📅 Iniciado em: ${new Date().toISOString()}`);
  console.log(`🔍 DATABASE_URL configurada: ${!!process.env.DATABASE_URL}`);
  console.log(`🔍 JWT_SECRET configurada: ${!!process.env.JWT_SECRET}`);
  console.log(`🔍 ALLOWED_ORIGIN: ${process.env.ALLOWED_ORIGIN}`);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (err) => {
  console.error('Erro não capturado:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Promise rejeitada não tratada:', err);
  process.exit(1);
});

module.exports = app;