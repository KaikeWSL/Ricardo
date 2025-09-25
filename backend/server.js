const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Importar rotas
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

// Middleware de segurança
app.use(helmet());

// Configurar CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN === '*' ? true : process.env.ALLOWED_ORIGIN,
  credentials: true
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

// Rota de saúde
app.get('/health', async (req, res) => {
  try {
    // Testar conexão com banco
    const dbTest = await require('./config/database').query('SELECT 1 as test');
    
    res.json({
      success: true,
      message: 'Servidor funcionando normalmente',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      database: 'Conectado',
      dbTest: dbTest.rows[0]
    });
  } catch (error) {
    console.error('❌ Erro no health check:', error);
    res.status(500).json({
      success: false,
      message: 'Erro de conexão com banco de dados',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Aplicar rate limiting específico para login
app.use('/api/admin/login', loginLimiter);

// Rotas da API
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

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