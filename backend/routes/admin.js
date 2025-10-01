const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Função para obter data e hora do Brasil (UTC-3)
function getBrazilDateTime() {
  const now = new Date();
  const brasilOffset = -3 * 60; // UTC-3 em minutos
  const nowBrasil = new Date(now.getTime() + (brasilOffset * 60000));
  
  return {
    date: nowBrasil.toISOString().split('T')[0],
    time: nowBrasil.toTimeString().split(' ')[0].substring(0, 5),
    fullDate: nowBrasil
  };
}

// Middleware para verificar JWT
const verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token de acesso necessário' 
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error('Erro na verificação do token:', err);
      return res.status(403).json({ 
        success: false, 
        message: 'Token inválido ou expirado' 
      });
    }
    req.user = user;
    next();
  });
};

// POST /api/admin/login
router.post('/login', [
  body('usuario').notEmpty().trim().withMessage('Usuário é obrigatório'),
  body('senha').notEmpty().trim().withMessage('Senha é obrigatória')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { usuario, senha } = req.body;
    console.log('🔍 Tentativa de login para usuário:', usuario);

    const result = await pool.query(
      'SELECT id, usuario, senha_hash FROM admin WHERE usuario = $1',
      [usuario]
    );

    if (result.rows.length === 0) {
      console.log('❌ Usuário não encontrado:', usuario);
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    const admin = result.rows[0];
    console.log('🔍 Admin encontrado:', { id: admin.id, usuario: admin.usuario });

    const senhaValida = await bcrypt.compare(senha, admin.senha_hash);
    console.log('🔍 Senha válida:', senhaValida);

    if (!senhaValida) {
      console.log('❌ Senha inválida para usuário:', usuario);
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    const token = jwt.sign(
      { id: admin.id, usuario: admin.usuario },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Login bem-sucedido para usuário:', usuario);
    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      token,
      admin: { id: admin.id, usuario: admin.usuario }
    });

  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/profile
router.get('/profile', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, usuario, created_at FROM admin WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    res.json({
      success: true,
      admin: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/agendamentos
router.get('/agendamentos', verificarToken, async (req, res) => {
  try {
    const { data, status } = req.query;
    
    // Primeiro, atualizar agendamentos que já passaram para "atrasado"
    const brazilNow = getBrazilDateTime();
    
    console.log(`🕒 Verificando agendamentos atrasados - Data atual Brasil: ${brazilNow.date} ${brazilNow.time}`);
    
    await pool.query(`
      UPDATE agendamentos 
      SET status = 'atrasado', updated_at = CURRENT_TIMESTAMP 
      WHERE status = 'agendado' 
      AND (
        data < $1 
        OR (data = $1 AND horario < $2)
      )
    `, [brazilNow.date, brazilNow.time]);
    
    let query = `
      SELECT a.*, s.nome_servico, s.preco, s.duracao 
      FROM agendamentos a
      LEFT JOIN servicos s ON a.servico_id = s.id
      WHERE 1=1
    `;
    let params = [];
    let paramCount = 0;

    if (data) {
      paramCount++;
      query += ` AND a.data = $${paramCount}`;
      params.push(data);
    }

    if (status) {
      paramCount++;
      query += ` AND a.status = $${paramCount}`;
      params.push(status);
    }

    query += ' ORDER BY a.data DESC, a.horario DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      agendamentos: result.rows
    });

  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/admin/agendamentos/:id/status
router.put('/agendamentos/:id/status', verificarToken, [
  body('status').isIn(['agendado', 'concluido', 'cancelado']).withMessage('Status inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(
      'UPDATE agendamentos SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Agendamento não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Status atualizado com sucesso',
      agendamento: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/servicos
router.get('/servicos', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM servicos WHERE ativo = true ORDER BY nome_servico'
    );

    res.json({
      success: true,
      servicos: result.rows
    });

  } catch (error) {
    console.error('Erro ao buscar serviços:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/admin/servicos
router.post('/servicos', verificarToken, [
  body('nome_servico').notEmpty().trim().withMessage('Nome do serviço é obrigatório'),
  body('preco').isFloat({ min: 0 }).withMessage('Preço deve ser um número positivo'),
  body('duracao').optional().isInt({ min: 1 }).withMessage('Duração deve ser um número inteiro positivo')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { nome_servico, preco, duracao = 60 } = req.body;

    const result = await pool.query(
      'INSERT INTO servicos (nome_servico, preco, duracao) VALUES ($1, $2, $3) RETURNING *',
      [nome_servico, preco, duracao]
    );

    res.status(201).json({
      success: true,
      message: 'Serviço criado com sucesso',
      servico: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar serviço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/admin/servicos/:id
router.put('/servicos/:id', verificarToken, [
  body('nome_servico').optional().notEmpty().trim().withMessage('Nome do serviço não pode estar vazio'),
  body('preco').optional().isFloat({ min: 0 }).withMessage('Preço deve ser um número positivo'),
  body('duracao').optional().isInt({ min: 1 }).withMessage('Duração deve ser um número inteiro positivo')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const updates = req.body;

    const fields = [];
    const values = [];
    let paramCount = 0;

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        paramCount++;
        fields.push(`${key} = $${paramCount}`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum campo para atualizar'
      });
    }

    paramCount++;
    values.push(id);

    const query = `
      UPDATE servicos 
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $${paramCount} 
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Serviço não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Serviço atualizado com sucesso',
      servico: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar serviço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// DELETE /api/admin/servicos/:id
router.delete('/servicos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE servicos SET ativo = false WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Serviço não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Serviço removido com sucesso'
    });

  } catch (error) {
    console.error('Erro ao remover serviço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/dashboard - Estatísticas do dashboard
router.get('/dashboard', verificarToken, async (req, res) => {
  try {
    // Usar timezone do Brasil consistentemente
    const brazilNow = getBrazilDateTime();
    const hoje = brazilNow.date;
    const inicioMes = new Date(brazilNow.fullDate.getFullYear(), brazilNow.fullDate.getMonth(), 1).toISOString().split('T')[0];
    
    console.log(`📊 Dashboard - Data Brasil: ${hoje}`);
    
    // Agendamentos hoje
    const agendamentosHoje = await pool.query(
      'SELECT COUNT(*) FROM agendamentos WHERE data = $1 AND status = $2',
      [hoje, 'agendado']
    );
    
    // Agendamentos este mês
    const agendamentosMes = await pool.query(
      'SELECT COUNT(*) FROM agendamentos WHERE data >= $1 AND status = $2',
      [inicioMes, 'agendado']
    );
    
    // Serviços ativos
    const servicosAtivos = await pool.query(
      'SELECT COUNT(*) FROM servicos WHERE ativo = true'
    );
    
    // Produtos com estoque baixo
    const produtosEstoqueBaixo = await pool.query(
      'SELECT COUNT(*) FROM produtos WHERE estoque <= 5 AND ativo = true'
    );
    
    res.json({
      success: true,
      stats: {
        agendamentos_hoje: parseInt(agendamentosHoje.rows[0].count),
        agendamentos_mes: parseInt(agendamentosMes.rows[0].count),
        servicos_ativos: parseInt(servicosAtivos.rows[0].count),
        produtos_estoque_baixo: parseInt(produtosEstoqueBaixo.rows[0].count)
      }
    });
    
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/produtos - Listar produtos
router.get('/produtos', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM produtos WHERE ativo = true ORDER BY nome_produto'
    );

    res.json({
      success: true,
      produtos: result.rows
    });

  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/admin/produtos - Criar produto
router.post('/produtos', verificarToken, [
  body('nome_produto').notEmpty().trim().withMessage('Nome do produto é obrigatório'),
  body('preco').isFloat({ min: 0 }).withMessage('Preço deve ser um número positivo'),
  body('estoque').optional().isInt({ min: 0 }).withMessage('Estoque deve ser um número inteiro positivo')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { nome_produto, preco, estoque = 0 } = req.body;

    const result = await pool.query(
      'INSERT INTO produtos (nome_produto, preco, estoque) VALUES ($1, $2, $3) RETURNING *',
      [nome_produto, preco, estoque]
    );

    res.status(201).json({
      success: true,
      message: 'Produto criado com sucesso',
      produto: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/admin/produtos/:id - Atualizar produto
router.put('/produtos/:id', verificarToken, [
  body('nome_produto').optional().notEmpty().trim().withMessage('Nome do produto não pode estar vazio'),
  body('preco').optional().isFloat({ min: 0 }).withMessage('Preço deve ser um número positivo'),
  body('estoque').optional().isInt({ min: 0 }).withMessage('Estoque deve ser um número inteiro positivo')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const updates = req.body;

    const fields = [];
    const values = [];
    let paramCount = 0;

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        paramCount++;
        fields.push(`${key} = $${paramCount}`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum campo para atualizar'
      });
    }

    paramCount++;
    values.push(id);

    const query = `
      UPDATE produtos 
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $${paramCount} 
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produto não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Produto atualizado com sucesso',
      produto: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// DELETE /api/admin/produtos/:id - Remover produto
router.delete('/produtos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE produtos SET ativo = false WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produto não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Produto removido com sucesso'
    });

  } catch (error) {
    console.error('Erro ao remover produto:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/configuracoes - Obter configurações do salão
router.get('/configuracoes', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT nome_config, valor FROM configuracao_salao WHERE ativo = true ORDER BY nome_config'
    );
    
    // Converter para o formato esperado pelo frontend
    const configs = {
      hora_abertura: '09:00',
      hora_fechamento: '18:00',
      almoco_inicio: '12:00',
      almoco_fim: '13:00',
      duracao_slot: 60,
      dias_funcionamento: [true, true, true, true, true, true, false] // seg a dom
    };
    
    // Aplicar valores do banco se existirem
    result.rows.forEach(row => {
      switch (row.nome_config) {
        case 'hora_abertura':
        case 'hora_fechamento':
        case 'almoco_inicio':
        case 'almoco_fim':
          configs[row.nome_config] = row.valor;
          break;
        case 'duracao_slot':
          configs[row.nome_config] = parseInt(row.valor) || 60;
          break;
        case 'dias_funcionamento':
          try {
            configs[row.nome_config] = JSON.parse(row.valor);
          } catch (e) {
            // Manter valor padrão se houver erro no parse
            console.warn('Erro ao parsear dias_funcionamento:', e);
          }
          break;
      }
    });
    
    console.log('Enviando configurações:', configs);
    
    res.json({
      success: true,
      configuracoes: configs
    });
  } catch (error) {
    console.error('Erro ao buscar configurações:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// PUT /api/admin/configuracoes - Atualizar configurações do salão
router.put('/configuracoes', verificarToken, async (req, res) => {
  try {
    const configs = req.body;
    console.log('Recebendo configurações:', configs);
    
    // Mapear os dados recebidos para o formato do banco
    const configsParaSalvar = {
      'hora_abertura': configs.hora_abertura,
      'hora_fechamento': configs.hora_fechamento,
      'almoco_inicio': configs.almoco_inicio,
      'almoco_fim': configs.almoco_fim,
      'duracao_slot': configs.duracao_slot?.toString(),
      'dias_funcionamento': JSON.stringify(configs.dias_funcionamento)
    };
    
    console.log('Configs formatadas:', configsParaSalvar);
    
    // Atualizar ou inserir cada configuração
    for (const [nome_config, valor] of Object.entries(configsParaSalvar)) {
      if (valor !== undefined && valor !== null) {
        await pool.query(`
          INSERT INTO configuracao_salao (nome_config, valor, updated_at) 
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (nome_config) 
          DO UPDATE SET valor = $2, updated_at = CURRENT_TIMESTAMP
        `, [nome_config, valor]);
        
        console.log(`Salvou ${nome_config}: ${valor}`);
      }
    }
    
    console.log('✅ Configurações salvas com sucesso');
    res.json({ 
      success: true, 
      message: 'Configurações atualizadas com sucesso' 
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar configurações:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// GET /api/admin/horarios-bloqueados - Listar períodos bloqueados
router.get('/horarios-bloqueados', verificarToken, async (req, res) => {
  try {
    const { data } = req.query;
    
    let query = `
      SELECT id, data_inicio, horario_inicio, data_fim, horario_fim, 
             motivo, tipo, ativo, created_at 
      FROM horarios_bloqueados 
      WHERE ativo = true
    `;
    let params = [];
    
    if (data) {
      query += ' AND (data_inicio = $1 OR (data_inicio <= $1 AND (data_fim IS NULL OR data_fim >= $1)))';
      params.push(data);
    }
    
    query += ' ORDER BY data_inicio, horario_inicio';
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      horarios_bloqueados: result.rows
    });

  } catch (error) {
    console.error('Erro ao buscar períodos bloqueados:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/admin/horarios-bloqueados - Bloquear período
router.post('/horarios-bloqueados', verificarToken, [
  body('data_inicio').isISO8601().withMessage('Data início inválida'),
  body('horario_inicio').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Horário início inválido'),
  body('data_fim').optional().isISO8601().withMessage('Data fim inválida'),
  body('horario_fim').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Horário fim inválido'),
  body('motivo').notEmpty().trim().isLength({ max: 255 }).withMessage('Motivo é obrigatório'),
  body('tipo').optional().isIn(['temporario', 'recorrente', 'intervalo']).withMessage('Tipo inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { 
      data_inicio, 
      horario_inicio, 
      data_fim, 
      horario_fim, 
      motivo, 
      tipo = 'temporario' 
    } = req.body;

    const result = await pool.query(
      `INSERT INTO horarios_bloqueados 
       (data_inicio, horario_inicio, data_fim, horario_fim, motivo, tipo) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [data_inicio, horario_inicio, data_fim, horario_fim, motivo, tipo]
    );

    res.status(201).json({
      success: true,
      message: 'Período bloqueado com sucesso',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Erro ao bloquear período:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// DELETE /api/admin/horarios-bloqueados/:id - Desbloquear período
router.delete('/horarios-bloqueados/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE horarios_bloqueados SET ativo = false WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Período bloqueado não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Período desbloqueado com sucesso'
    });

  } catch (error) {
    console.error('Erro ao desbloquear período:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/admin/configuracoes/inicializar - Criar configurações padrão
router.post('/configuracoes/inicializar', verificarToken, async (req, res) => {
  try {
    console.log('🔧 Inicializando configurações padrão...');
    
    const configuracoesDefault = [
      { nome_config: 'horario_abertura', valor: '08:00' },
      { nome_config: 'horario_fechamento', valor: '18:00' },
      { nome_config: 'intervalo_inicio', valor: '12:00' },
      { nome_config: 'intervalo_fim', valor: '13:00' },
      { nome_config: 'duracao_slot', valor: '30' },
      { nome_config: 'dias_funcionamento', valor: 'segunda,terca,quarta,quinta,sexta,sabado' }
    ];
    
    for (const config of configuracoesDefault) {
      await pool.query(
        `INSERT INTO configuracao_salao (nome_config, valor, ativo) 
         VALUES ($1, $2, true) 
         ON CONFLICT (nome_config) 
         DO UPDATE SET valor = EXCLUDED.valor, ativo = true`,
        [config.nome_config, config.valor]
      );
    }
    
    console.log('✅ Configurações padrão inicializadas');
    
    res.json({
      success: true,
      message: 'Configurações padrão inicializadas com sucesso'
    });
    
  } catch (error) {
    console.error('Erro ao inicializar configurações:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;