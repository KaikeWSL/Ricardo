-- Script simples para testar se a estrutura básica funciona
-- Execute este SQL primeiro para criar uma versão mínima

-- Verificar se existe a tabela agendamentos
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'agendamentos'
);

-- Se não existir, criar estrutura básica
CREATE TABLE IF NOT EXISTS agendamentos (
    id SERIAL PRIMARY KEY,
    nome_cliente VARCHAR(255) NOT NULL,
    telefone VARCHAR(20) NOT NULL,
    data DATE NOT NULL,
    horario TIME NOT NULL,
    servico_id INTEGER NOT NULL,
    observacoes TEXT,
    status VARCHAR(50) DEFAULT 'agendado',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Verificar se existe a tabela servicos
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'servicos'
);

-- Se não existir, criar estrutura básica
CREATE TABLE IF NOT EXISTS servicos (
    id SERIAL PRIMARY KEY,
    nome_servico VARCHAR(255) NOT NULL,
    preco DECIMAL(10,2) NOT NULL,
    duracao INTEGER DEFAULT 30,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inserir um serviço básico para teste
INSERT INTO servicos (nome_servico, preco, duracao) 
VALUES ('Corte Masculino', 25.00, 30)
ON CONFLICT DO NOTHING;

-- Verificar os dados
SELECT 'Tabelas criadas com sucesso!' as status;
SELECT * FROM servicos LIMIT 5;