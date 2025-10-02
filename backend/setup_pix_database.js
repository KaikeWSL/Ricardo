const pool = require('./config/database');
const fs = require('fs');
const path = require('path');

async function executarScript() {
    try {
        console.log('🔄 Executando script de criação da tabela pagamentos_pix...');
        
        // Ler o script SQL
        const sqlScript = fs.readFileSync(
            path.join(__dirname, 'schema/pagamentos_pix_postgresql.sql'), 
            'utf8'
        );
        
        // Executar o script
        await pool.query(sqlScript);
        
        console.log('✅ Script executado com sucesso!');
        console.log('✅ Tabela pagamentos_pix criada');
        console.log('✅ Triggers configurados');
        console.log('✅ Views criadas');
        console.log('✅ Configurações inseridas');
        
        // Verificar se as tabelas foram criadas
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('pagamentos_pix', 'configuracoes')
            ORDER BY table_name;
        `);
        
        console.log('\n📋 Tabelas criadas:');
        result.rows.forEach(row => {
            console.log(`  ✓ ${row.table_name}`);
        });
        
        // Verificar configurações
        const configs = await pool.query('SELECT * FROM configuracoes WHERE chave LIKE \'pix_%\'');
        console.log('\n⚙️ Configurações PIX:');
        configs.rows.forEach(config => {
            console.log(`  ✓ ${config.chave}: ${config.valor} - ${config.descricao}`);
        });
        
    } catch (error) {
        console.error('❌ Erro ao executar script:', error.message);
        if (error.detail) {
            console.error('   Detalhes:', error.detail);
        }
    } finally {
        await pool.end();
        console.log('\n🔌 Conexão com banco fechada');
    }
}

executarScript();