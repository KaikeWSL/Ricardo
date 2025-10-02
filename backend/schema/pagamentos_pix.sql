-- =============================================
-- SCRIPT DE CRIAÇÃO DA TABELA PAGAMENTOS PIX
-- Sistema de Agendamento com Garantia PIX
-- =============================================

-- Criar tabela para controle de pagamentos PIX
CREATE TABLE IF NOT EXISTS pagamentos_pix (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Identificação
    agendamento_id INT NOT NULL,
    pix_id VARCHAR(100) UNIQUE NOT NULL,
    
    -- Dados do PIX
    valor DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    qr_code TEXT NOT NULL,
    emv_code TEXT NOT NULL,
    
    -- Provedor de pagamento
    provider ENUM('asaas', 'mercadopago', 'local') NOT NULL DEFAULT 'local',
    provider_payment_id VARCHAR(100),
    
    -- Status do pagamento
    status ENUM('pending', 'paid', 'expired', 'cancelled') NOT NULL DEFAULT 'pending',
    
    -- Dados adicionais
    customer_data JSON,
    webhook_data JSON,
    
    -- Controle de tempo
    expires_at DATETIME NOT NULL,
    paid_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_agendamento (agendamento_id),
    INDEX idx_pix_id (pix_id),
    INDEX idx_provider_payment (provider_payment_id),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at),
    
    -- Chave estrangeira
    FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE
);

-- Criar trigger para atualizar status do agendamento quando PIX for pago
DELIMITER //

CREATE TRIGGER tr_pagamento_pix_paid 
AFTER UPDATE ON pagamentos_pix
FOR EACH ROW
BEGIN
    -- Quando PIX for confirmado, atualizar status do agendamento
    IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
        UPDATE agendamentos 
        SET 
            pix_pago = TRUE,
            pix_data_pagamento = NEW.paid_at,
            updated_at = NOW()
        WHERE id = NEW.agendamento_id;
    END IF;
END//

DELIMITER ;

-- Adicionar colunas na tabela agendamentos se não existirem
ALTER TABLE agendamentos 
ADD COLUMN IF NOT EXISTS pix_pago BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS pix_data_pagamento DATETIME NULL,
ADD COLUMN IF NOT EXISTS pix_valor_garantia DECIMAL(10,2) DEFAULT 5.00;

-- Criar índice para buscar agendamentos com PIX pago
CREATE INDEX IF NOT EXISTS idx_agendamentos_pix_pago ON agendamentos(pix_pago);

-- =============================================
-- DADOS INICIAIS E CONFIGURAÇÕES
-- =============================================

-- Inserir configuração do valor da garantia PIX
INSERT IGNORE INTO configuracoes (chave, valor, descricao) VALUES 
('pix_garantia_valor', '5.00', 'Valor da garantia PIX para agendamentos (R$)'),
('pix_timeout_minutes', '15', 'Tempo limite para pagamento PIX (minutos)'),
('pix_providers_enabled', 'asaas,mercadopago,local', 'Provedores PIX habilitados (separados por vírgula)');

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
    
    TIMESTAMPDIFF(MINUTE, pp.created_at, COALESCE(pp.paid_at, NOW())) as tempo_pagamento_minutos
    
FROM pagamentos_pix pp
JOIN agendamentos a ON pp.agendamento_id = a.id
JOIN servicos s ON a.servico_id = s.id
ORDER BY pp.created_at DESC;

-- =============================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =============================================

/*
TABELA: pagamentos_pix
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

VIEWS:
- vw_relatorio_pix: Relatório completo de pagamentos

CONFIGURAÇÕES:
- pix_garantia_valor: Valor da garantia (padrão R$ 5,00)
- pix_timeout_minutes: Tempo limite (padrão 15 minutos)
*/