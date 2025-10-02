-- =============================================
-- SCRIPT DE CRIAÇÃO DA TABELA PAGAMENTOS PIX
-- Sistema de Agendamento com Garantia PIX
-- PostgreSQL (Neon Database)
-- =============================================

-- Criar extensão para UUID se não existir
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Criar ENUM para status de pagamento
CREATE TYPE pagamento_status AS ENUM ('pending', 'paid', 'expired', 'cancelled');

-- Criar ENUM para provedores PIX
CREATE TYPE pix_provider AS ENUM ('asaas', 'mercadopago', 'local');

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
    
    -- Provedor de pagamento
    provider pix_provider NOT NULL DEFAULT 'local',
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

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_agendamento ON pagamentos_pix(agendamento_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_pix_id ON pagamentos_pix(pix_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_provider_payment ON pagamentos_pix(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_status ON pagamentos_pix(status);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_expires_at ON pagamentos_pix(expires_at);

-- Adicionar colunas na tabela agendamentos se não existirem
DO $$ 
BEGIN
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

-- Inserir configuração do valor da garantia PIX
INSERT INTO configuracoes (chave, valor, descricao) VALUES 
('pix_garantia_valor', '5.00', 'Valor da garantia PIX para agendamentos (R$)'),
('pix_timeout_minutes', '15', 'Tempo limite para pagamento PIX (minutos)'),
('pix_providers_enabled', 'asaas,mercadopago,local', 'Provedores PIX habilitados (separados por vírgula)')
ON CONFLICT (chave) DO NOTHING;

-- =============================================
-- VIEWS PARA RELATÓRIOS
-- =============================================

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
    a.cliente_nome,
    a.cliente_telefone,
    a.data_agendamento,
    a.horario,
    s.nome as servico_nome,
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
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =============================================

/*
TABELA: pagamentos_pix (PostgreSQL)
- Controla todos os pagamentos PIX de garantia
- Suporta múltiplos provedores (Asaas, Mercado Pago, Local)
- Status automático por trigger
- Expiração automática por tempo

CAMPOS PRINCIPAIS:
- pix_id: Identificador único do PIX
- provider: Provedor usado (asaas/mercadopago/local)
- status: pending/paid/expired/cancelled
- qr_code: Código QR para pagamento
- emv_code: Código EMV do PIX

TRIGGERS:
- tr_pagamento_pix_paid: Atualiza agendamento quando PIX é pago
- tr_pagamentos_pix_updated_at: Atualiza campo updated_at

VIEWS:
- vw_relatorio_pix: Relatório completo de pagamentos

CONFIGURAÇÕES:
- pix_garantia_valor: Valor da garantia (padrão R$ 5,00)
- pix_timeout_minutes: Tempo limite (padrão 15 minutos)

TIPOS ENUM:
- pagamento_status: pending, paid, expired, cancelled
- pix_provider: asaas, mercadopago, local
*/