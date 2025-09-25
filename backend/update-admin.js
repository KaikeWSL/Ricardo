// Script para atualizar credenciais do admin
// Execute este script no servidor ou localmente com node

const bcrypt = require('bcrypt');
const pool = require('./config/database');

async function updateAdminCredentials() {
    try {
        console.log('🔐 Atualizando credenciais do admin...');
        
        // Gerar hash da nova senha
        const newPassword = 'Ricardo123';
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        console.log('Hash gerado:', hashedPassword);
        
        // Atualizar no banco
        const result = await pool.query(
            `INSERT INTO admin (usuario, senha_hash) VALUES ($1, $2) 
             ON CONFLICT (usuario) DO UPDATE SET senha_hash = $2`,
            ['Ricardo', hashedPassword]
        );
        
        console.log('✅ Credenciais atualizadas com sucesso!');
        console.log('📋 Novas credenciais:');
        console.log('   Usuário: Ricardo');
        console.log('   Senha: Ricardo123');
        
        // Verificar se funcionou
        const check = await pool.query('SELECT usuario FROM admin WHERE usuario = $1', ['Ricardo']);
        console.log('🔍 Verificação:', check.rows.length > 0 ? 'Admin encontrado' : 'Erro');
        
    } catch (error) {
        console.error('❌ Erro ao atualizar credenciais:', error);
    } finally {
        process.exit(0);
    }
}

updateAdminCredentials();