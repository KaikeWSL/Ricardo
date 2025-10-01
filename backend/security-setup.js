/**
 * Sistema de Inicialização Segura
 * Este arquivo gerencia a primeira configuração do sistema
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('./config/database');

class SecuritySetup {
    constructor() {
        this.saltRounds = 12;
    }

    // Gerar uma chave JWT segura
    generateJWTSecret() {
        return crypto.randomBytes(64).toString('hex');
    }

    // Verificar se existe algum admin no sistema
    async hasAdminUsers() {
        try {
            const result = await pool.query('SELECT COUNT(*) as count FROM admin');
            return parseInt(result.rows[0].count) > 0;
        } catch (error) {
            console.error('Erro ao verificar admins:', error);
            return false;
        }
    }

    // Criar primeiro admin do sistema
    async createFirstAdmin(usuario, senha) {
        try {
            const hasAdmins = await this.hasAdminUsers();
            if (hasAdmins) {
                throw new Error('Já existem administradores no sistema');
            }

            // Validar senha forte
            if (!this.isStrongPassword(senha)) {
                throw new Error('Senha deve ter pelo menos 8 caracteres, incluindo maiúscula, minúscula, número e símbolo');
            }

            const hashedPassword = await bcrypt.hash(senha, this.saltRounds);
            
            await pool.query(
                'INSERT INTO admin (usuario, senha_hash) VALUES ($1, $2)',
                [usuario, hashedPassword]
            );

            console.log('✅ Primeiro administrador criado com sucesso');
            return true;

        } catch (error) {
            console.error('❌ Erro ao criar primeiro admin:', error);
            throw error;
        }
    }

    // Validar se a senha é forte
    isStrongPassword(senha) {
        const minLength = 8;
        const hasUpperCase = /[A-Z]/.test(senha);
        const hasLowerCase = /[a-z]/.test(senha);
        const hasNumbers = /\d/.test(senha);
        const hasSymbols = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(senha);

        return senha.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSymbols;
    }

    // Verificar se o sistema está inicializado
    async isSystemInitialized() {
        const hasAdmins = await this.hasAdminUsers();
        const hasJWTSecret = !!process.env.JWT_SECRET && process.env.JWT_SECRET !== 'sua_chave_secreta_super_segura_aqui_123456789';
        
        return hasAdmins && hasJWTSecret;
    }

    // Gerar relatório de segurança
    async getSecurityReport() {
        const hasAdmins = await this.hasAdminUsers();
        const hasJWTSecret = !!process.env.JWT_SECRET;
        const isDefaultJWT = process.env.JWT_SECRET === 'sua_chave_secreta_super_segura_aqui_123456789';
        
        let adminCount = 0;
        try {
            const result = await pool.query('SELECT COUNT(*) as count FROM admin');
            adminCount = parseInt(result.rows[0].count);
        } catch (error) {
            console.error('Erro ao contar admins:', error);
        }

        return {
            initialized: await this.isSystemInitialized(),
            hasAdmins,
            adminCount,
            hasJWTSecret,
            isDefaultJWT,
            securityIssues: this.getSecurityIssues(hasAdmins, hasJWTSecret, isDefaultJWT)
        };
    }

    // Identificar problemas de segurança
    getSecurityIssues(hasAdmins, hasJWTSecret, isDefaultJWT) {
        const issues = [];

        if (!hasAdmins) {
            issues.push({
                level: 'CRITICAL',
                message: 'Nenhum administrador configurado no sistema',
                solution: 'Execute o setup inicial para criar o primeiro admin'
            });
        }

        if (!hasJWTSecret) {
            issues.push({
                level: 'CRITICAL',
                message: 'JWT_SECRET não configurado',
                solution: 'Configure uma chave JWT segura no arquivo .env'
            });
        }

        if (isDefaultJWT) {
            issues.push({
                level: 'HIGH',
                message: 'JWT_SECRET usando valor padrão inseguro',
                solution: 'Gere uma nova chave JWT segura'
            });
        }

        return issues;
    }

    // Atualizar senha de admin existente
    async updateAdminPassword(usuario, senhaAtual, novaSenha) {
        try {
            // Verificar usuário atual
            const admin = await pool.query('SELECT * FROM admin WHERE usuario = $1', [usuario]);
            if (admin.rows.length === 0) {
                throw new Error('Usuário não encontrado');
            }

            // Verificar senha atual
            const senhaValida = await bcrypt.compare(senhaAtual, admin.rows[0].senha_hash);
            if (!senhaValida) {
                throw new Error('Senha atual incorreta');
            }

            // Validar nova senha
            if (!this.isStrongPassword(novaSenha)) {
                throw new Error('Nova senha deve ter pelo menos 8 caracteres, incluindo maiúscula, minúscula, número e símbolo');
            }

            // Atualizar senha
            const hashedPassword = await bcrypt.hash(novaSenha, this.saltRounds);
            await pool.query(
                'UPDATE admin SET senha_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE usuario = $2',
                [hashedPassword, usuario]
            );

            console.log('✅ Senha atualizada com sucesso para:', usuario);
            return true;

        } catch (error) {
            console.error('❌ Erro ao atualizar senha:', error);
            throw error;
        }
    }

    // Remover arquivos inseguros
    async cleanupInsecureFiles() {
        const fs = require('fs').promises;
        const path = require('path');
        
        const filesToRemove = [
            'generate-hash.js',
            'backend/update-admin.js'
        ];

        for (const file of filesToRemove) {
            try {
                const filePath = path.join(__dirname, '..', file);
                await fs.unlink(filePath);
                console.log(`🗑️ Arquivo inseguro removido: ${file}`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.warn(`⚠️ Erro ao remover ${file}:`, error.message);
                }
            }
        }
    }
}

module.exports = SecuritySetup;