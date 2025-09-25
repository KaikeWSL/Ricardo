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

// Configurar CORS - Permitir múltiplas origens
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'https://visionary-fairy-3e00b0.netlify.app',
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

// Rota temporária para atualizar credenciais admin (REMOVER DEPOIS)
app.get('/update-admin-secret', async (req, res) => {
  try {
    const bcrypt = require('bcrypt');
    const pool = require('./config/database');
    
    console.log('🔐 Atualizando credenciais do admin...');
    
    // Primeiro, limpar admin antigo
    await pool.query('DELETE FROM admin WHERE usuario IN ($1, $2)', ['admin', 'Ricardo']);
    
    // Gerar hash da nova senha
    const newPassword = 'Ricardo123';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    console.log('Hash gerado:', hashedPassword);
    
    // Inserir novo admin
    await pool.query(
        `INSERT INTO admin (usuario, senha_hash) VALUES ($1, $2)`,
        ['Ricardo', hashedPassword]
    );
    
    // Verificar se foi inserido corretamente
    const check = await pool.query('SELECT usuario, senha_hash FROM admin WHERE usuario = $1', ['Ricardo']);
    
    res.json({
      success: true,
      message: 'Credenciais atualizadas com sucesso!',
      credentials: {
        usuario: 'Ricardo',
        senha: 'Ricardo123'
      },
      hash_generated: hashedPassword,
      admin_found: check.rows.length > 0,
      admin_data: check.rows[0] || null
    });
    
    console.log('✅ Credenciais atualizadas: Ricardo/Ricardo123');
    console.log('Hash usado:', hashedPassword);
    
  } catch (error) {
    console.error('❌ Erro ao atualizar credenciais:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar credenciais',
      error: error.message
    });
  }
});

// Rota para verificar admin atual (REMOVER DEPOIS)
app.get('/check-admin', async (req, res) => {
  try {
    const pool = require('./config/database');
    
    const admins = await pool.query('SELECT id, usuario, senha_hash, created_at FROM admin ORDER BY id');
    
    res.json({
      success: true,
      total_admins: admins.rows.length,
      admins: admins.rows.map(admin => ({
        id: admin.id,
        usuario: admin.usuario,
        senha_hash: admin.senha_hash.substring(0, 20) + '...',
        created_at: admin.created_at
      }))
    });
    
  } catch (error) {
    console.error('❌ Erro ao verificar admin:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar admin',
      error: error.message
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