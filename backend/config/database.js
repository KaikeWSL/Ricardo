const { Pool } = require('pg');
require('dotenv').config();

// Log para debug (REMOVER EM PRODUÇÃO)
console.log('🔍 DATABASE_URL (primeiros 50 chars):', process.env.DATABASE_URL?.substring(0, 50) + '...');
console.log('🔍 DATABASE_URL existe:', !!process.env.DATABASE_URL);

// Configuração da conexão com PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Teste de conexão
pool.on('connect', () => {
  console.log('✅ Conectado ao banco de dados PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Erro na conexão com o banco:', err);
});

module.exports = pool;