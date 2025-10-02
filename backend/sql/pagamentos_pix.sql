-- Tabela para controle de pagamentos PIX
CREATE TABLE IF NOT EXISTS pagamentos_pix (
    id SERIAL PRIMARY KEY,
    agendamento_id INTEGER NOT NULL REFERENCES agendamentos(id),
    txid VARCHAR(50) NOT NULL,
    hash_pagamento VARCHAR(32),
    valor DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pendente', -- pendente, pago, expirado, cancelado
    codigo_emv TEXT NOT NULL,
    tipo_pix VARCHAR(20) DEFAULT 'local', -- local, mercadopago, asaas, banco
    payment_id_externo VARCHAR(100), -- ID do pagamento na API externa
    external_reference VARCHAR(50), -- Referência externa (MP, Asaas, etc)
    end_to_end_id VARCHAR(100), -- ID único da transação quando paga
    data_pagamento TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_agendamento ON pagamentos_pix(agendamento_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_txid ON pagamentos_pix(txid);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_hash ON pagamentos_pix(hash_pagamento);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_status ON pagamentos_pix(status);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_external ON pagamentos_pix(payment_id_externo);

-- Adicionar colunas na tabela agendamentos se não existirem
DO $$ 
BEGIN
    -- Adicionar coluna de comprovante se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'agendamentos' AND column_name = 'comprovante_pagamento') THEN
        ALTER TABLE agendamentos ADD COLUMN comprovante_pagamento TEXT;
    END IF;
    
    -- Adicionar coluna de data de pagamento se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'agendamentos' AND column_name = 'data_pagamento') THEN
        ALTER TABLE agendamentos ADD COLUMN data_pagamento TIMESTAMP;
    END IF;
    
    -- Adicionar novas colunas na tabela de pagamentos se não existirem
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'pagamentos_pix' AND column_name = 'tipo_pix') THEN
        ALTER TABLE pagamentos_pix ADD COLUMN tipo_pix VARCHAR(20) DEFAULT 'local';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'pagamentos_pix' AND column_name = 'payment_id_externo') THEN
        ALTER TABLE pagamentos_pix ADD COLUMN payment_id_externo VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'pagamentos_pix' AND column_name = 'external_reference') THEN
        ALTER TABLE pagamentos_pix ADD COLUMN external_reference VARCHAR(50);
    END IF;
END $$;

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_pagamentos_pix_updated_at ON pagamentos_pix;
CREATE TRIGGER update_pagamentos_pix_updated_at
    BEFORE UPDATE ON pagamentos_pix
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();