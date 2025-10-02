-- =============================================
-- SCRIPT DE CRIAÇÃO DA TABELA PAGAMENTOS PIX
-- Sistema de Agendamento com Garantia PIX
-- PostgreSQL (Neon Database) - VERSÃO SEGURA
-- =============================================

-- Criar extensão para UUID se não existir
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Criar ENUM para status de pagamento (apenas se não existir)
DO $$ BEGIN
    CREATE TYPE pagamento_status AS ENUM ('pending', 'paid', 'expired', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Criar ENUM para provedores PIX (apenas Asaas)
DO $$ BEGIN
    CREATE TYPE pix_provider AS ENUM ('asaas');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Criar tabela para controle de pagamentos PIX
CREATE TABLE IF NOT EXISTS pagamentos_pix (
    id SERIAL PRIMARY KEY,
    
    -- Identificação
    agendamento_id INTEGER NOT NULL,
    pix_id VARCHAR(100) UNIQUE NOT NULL,
    
    -- Dados do PIX
    valor DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    qr_code TEXT NOT NULL,
    emv_code TEXT NOT NULL,
    
    -- Provedor de pagamento (apenas Asaas)
    provider pix_provider NOT NULL DEFAULT 'asaas',
    provider_payment_id VARCHAR(100),
    
    -- Status do pagamento
    status pagamento_status NOT NULL DEFAULT 'pending',
    
    -- Dados adicionais (JSON)
    customer_data JSONB,
    webhook_data JSONB,
    
    -- Controle de tempo
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar índices apenas se não existirem
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_agendamento ON pagamentos_pix(agendamento_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_pix_id ON pagamentos_pix(pix_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_provider_payment ON pagamentos_pix(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_status ON pagamentos_pix(status);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_expires_at ON pagamentos_pix(expires_at);

-- Verificar se tabela agendamentos existe antes de adicionar colunas
DO $$ 
BEGIN
    -- Verificar se a tabela agendamentos existe
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'agendamentos') THEN
        
        -- Adicionar coluna pix_pago
        BEGIN
            ALTER TABLE agendamentos ADD COLUMN pix_pago BOOLEAN DEFAULT FALSE;
        EXCEPTION
            WHEN duplicate_column THEN NULL;
        END;
        
        -- Adicionar coluna pix_data_pagamento
        BEGIN
            ALTER TABLE agendamentos ADD COLUMN pix_data_pagamento TIMESTAMP WITH TIME ZONE NULL;
        EXCEPTION
            WHEN duplicate_column THEN NULL;
        END;
        
        -- Adicionar coluna pix_valor_garantia
        BEGIN
            ALTER TABLE agendamentos ADD COLUMN pix_valor_garantia DECIMAL(10,2) DEFAULT 5.00;
        EXCEPTION
            WHEN duplicate_column THEN NULL;
        END;
        
    ELSE
        -- Criar tabela agendamentos básica se não existir
        CREATE TABLE agendamentos (
            id SERIAL PRIMARY KEY,
            nome_cliente VARCHAR(255) NOT NULL,
            telefone VARCHAR(20) NOT NULL,
            data DATE NOT NULL,
            horario TIME NOT NULL,
            servico_id INTEGER NOT NULL,
            observacoes TEXT,
            status VARCHAR(50) DEFAULT 'agendado',
            pix_pago BOOLEAN DEFAULT FALSE,
            pix_data_pagamento TIMESTAMP WITH TIME ZONE NULL,
            pix_valor_garantia DECIMAL(10,2) DEFAULT 5.00,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    END IF;
END $$;

-- Criar índice para buscar agendamentos com PIX pago
CREATE INDEX IF NOT EXISTS idx_agendamentos_pix_pago ON agendamentos(pix_pago);

-- Criar função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger para updated_at
DROP TRIGGER IF EXISTS tr_pagamentos_pix_updated_at ON pagamentos_pix;
CREATE TRIGGER tr_pagamentos_pix_updated_at
    BEFORE UPDATE ON pagamentos_pix
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Criar trigger para atualizar status do agendamento quando PIX for pago
CREATE OR REPLACE FUNCTION tr_pagamento_pix_paid_function()
RETURNS TRIGGER AS $$
BEGIN
    -- Quando PIX for confirmado, atualizar status do agendamento
    IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
        UPDATE agendamentos 
        SET 
            pix_pago = TRUE,
            pix_data_pagamento = NEW.paid_at,
            updated_at = NOW()
        WHERE id = NEW.agendamento_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS tr_pagamento_pix_paid ON pagamentos_pix;
CREATE TRIGGER tr_pagamento_pix_paid
    AFTER UPDATE ON pagamentos_pix
    FOR EACH ROW
    EXECUTE FUNCTION tr_pagamento_pix_paid_function();

-- =============================================
-- DADOS INICIAIS E CONFIGURAÇÕES
-- =============================================

-- Criar tabela de configurações se não existir
CREATE TABLE IF NOT EXISTS configuracoes (
    id SERIAL PRIMARY KEY,
    chave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT NOT NULL,
    descricao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar tabela servicos se não existir
CREATE TABLE IF NOT EXISTS servicos (
    id SERIAL PRIMARY KEY,
    nome_servico VARCHAR(255) NOT NULL,
    preco DECIMAL(10,2) NOT NULL,
    duracao INTEGER DEFAULT 30,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inserir configuração do valor da garantia PIX
INSERT INTO configuracoes (chave, valor, descricao) VALUES 
('pix_garantia_valor', '5.00', 'Valor da garantia PIX para agendamentos (R$)'),
('pix_timeout_minutes', '15', 'Tempo limite para pagamento PIX (minutos)'),
('pix_providers_enabled', 'asaas', 'Provedor PIX habilitado: apenas Asaas')
ON CONFLICT (chave) DO NOTHING;

-- Inserir alguns serviços básicos para teste
INSERT INTO servicos (nome_servico, preco, duracao) VALUES 
('Corte Masculino', 25.00, 30),
('Corte + Barba', 35.00, 45),
('Progressiva', 150.00, 180),
('Luzes', 80.00, 120)
ON CONFLICT DO NOTHING;

-- =============================================
-- VIEWS PARA RELATÓRIOS
-- =============================================

-- Remover view se existir e recriar
DROP VIEW IF EXISTS vw_relatorio_pix;

-- View para relatório de pagamentos PIX
CREATE OR REPLACE VIEW vw_relatorio_pix AS
SELECT 
    pp.id,
    pp.pix_id,
    pp.valor,
    pp.provider,
    pp.status,
    pp.created_at,
    pp.paid_at,
    pp.expires_at,
    
    -- Dados do agendamento
    a.id as agendamento_id,
    a.nome_cliente,
    a.telefone,
    a.data,
    a.horario,
    s.nome_servico,
    s.preco as servico_preco,
    s.duracao as servico_duracao,
    
    -- Cálculos
    CASE 
        WHEN pp.status = 'paid' THEN 'Pago'
        WHEN pp.status = 'expired' THEN 'Expirado'
        WHEN pp.status = 'cancelled' THEN 'Cancelado'
        WHEN pp.expires_at < NOW() THEN 'Expirado'
        ELSE 'Pendente'
    END as status_descricao,
    
    EXTRACT(EPOCH FROM (COALESCE(pp.paid_at, NOW()) - pp.created_at)) / 60 as tempo_pagamento_minutos
    
FROM pagamentos_pix pp
JOIN agendamentos a ON pp.agendamento_id = a.id
JOIN servicos s ON a.servico_id = s.id
ORDER BY pp.created_at DESC;

-- =============================================
-- VERIFICAÇÕES FINAIS
-- =============================================

-- Verificar se tudo foi criado corretamente
SELECT 
    'Estrutura criada com sucesso!' as status,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'pagamentos_pix') as tabela_pix_criada,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'agendamentos') as tabela_agendamentos_existe,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'servicos') as tabela_servicos_existe,
    (SELECT COUNT(*) FROM servicos WHERE ativo = true) as servicos_ativos;

-- =============================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =============================================

/*
VERSÃO SEGURA DO SCRIPT PIX ASAAS
- Verifica se tipos ENUM já existem
- Cria tabelas básicas se não existirem
- Não gera erros em re-execução
- Insere dados de teste
- Sistema focado apenas no Asaas

PARA EXECUTAR:
1. Cole este SQL no seu cliente PostgreSQL
2. Execute todo o script
3. Inicie o servidor: npm start
4. Teste um agendamento

SISTEMA PRONTO! 🚀
*/