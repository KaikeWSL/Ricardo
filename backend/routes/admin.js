const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const router = express.Router();

// Middleware para verificar token JWT
const verificarToken = (req, res, next) => {
  const token = req.header('x-auth-token') || req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token de acesso necessário'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token inválido'
    });
  }
};

// POST /api/admin/login - Login administrativo
router.post('/login', [
  body('usuario').trim().isLength({ min: 3 }).withMessage('Usuário deve ter pelo menos 3 caracteres'),
  body('senha').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres')
], async (req, res) => {
  try {
    // Verificar erros de validação
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { usuario, senha } = req.body;

    // Buscar administrador no banco
    const admin = await pool.query('SELECT * FROM admin WHERE usuario = $1', [usuario]);
    
    if (admin.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    // Verificar senha
    const senhaValida = await bcrypt.compare(senha, admin.rows[0].senha_hash);
    
    if (!senhaValida) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    // Gerar token JWT
    const token = jwt.sign(
      { id: admin.rows[0].id, usuario: admin.rows[0].usuario },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      token: token,
      admin: {
        id: admin.rows[0].id,
        usuario: admin.rows[0].usuario
      }
    });

  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/agendamentos - Listar todos os agendamentos
router.get('/agendamentos', verificarToken, async (req, res) => {
  try {
    const { data_inicio, data_fim, status } = req.query;

    let query = `
      SELECT a.*, s.nome_servico, s.preco, s.duracao
      FROM agendamentos a
      LEFT JOIN servicos s ON a.servico_id = s.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Filtros opcionais
    if (data_inicio) {
      paramCount++;
      query += ` AND a.data >= $${paramCount}`;
      params.push(data_inicio);
    }

    if (data_fim) {
      paramCount++;
      query += ` AND a.data <= $${paramCount}`;
      params.push(data_fim);
    }

    if (status) {
      paramCount++;
      query += ` AND a.status = $${paramCount}`;
      params.push(status);
    }

    query += ' ORDER BY a.data DESC, a.horario DESC';

    const agendamentos = await pool.query(query, params);

    res.json({
      success: true,
      agendamentos: agendamentos.rows
    });

  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/admin/agendamentos/:id/status - Atualizar status do agendamento
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

    const resultado = await pool.query(
      'UPDATE agendamentos SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Agendamento não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Status atualizado com sucesso',
      agendamento: resultado.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/servicos - Listar todos os serviços
router.get('/servicos', verificarToken, async (req, res) => {
  try {
    const servicos = await pool.query('SELECT * FROM servicos ORDER BY nome_servico');
    
    res.json({
      success: true,
      servicos: servicos.rows
    });

  } catch (error) {
    console.error('Erro ao buscar serviços:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/admin/servicos/:id - Atualizar serviço
router.put('/servicos/:id', verificarToken, [
  body('nome_servico').trim().isLength({ min: 2, max: 100 }).withMessage('Nome deve ter entre 2 e 100 caracteres'),
  body('preco').isFloat({ min: 0 }).withMessage('Preço deve ser um valor válido'),
  body('duracao').isInt({ min: 1 }).withMessage('Duração deve ser um número inteiro positivo')
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
    const { nome_servico, preco, duracao, ativo } = req.body;

    const resultado = await pool.query(
      'UPDATE servicos SET nome_servico = $1, preco = $2, duracao = $3, ativo = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [nome_servico, preco, duracao, ativo !== undefined ? ativo : true, id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Serviço não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Serviço atualizado com sucesso',
      servico: resultado.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar serviço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/produtos - Listar todos os produtos
router.get('/produtos', verificarToken, async (req, res) => {
  try {
    const produtos = await pool.query('SELECT * FROM produtos ORDER BY nome_produto');
    
    res.json({
      success: true,
      produtos: produtos.rows
    });

  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/admin/produtos/:id - Atualizar produto
router.put('/produtos/:id', verificarToken, [
  body('nome_produto').trim().isLength({ min: 2, max: 100 }).withMessage('Nome deve ter entre 2 e 100 caracteres'),
  body('estoque').isInt({ min: 0 }).withMessage('Estoque deve ser um número inteiro não negativo'),
  body('preco').isFloat({ min: 0 }).withMessage('Preço deve ser um valor válido')
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
    const { nome_produto, estoque, preco, ativo } = req.body;

    const resultado = await pool.query(
      'UPDATE produtos SET nome_produto = $1, estoque = $2, preco = $3, ativo = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [nome_produto, estoque, preco, ativo !== undefined ? ativo : true, id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produto não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Produto atualizado com sucesso',
      produto: resultado.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/admin/dashboard - Dados do dashboard
router.get('/dashboard', verificarToken, async (req, res) => {
  try {
    // Contar agendamentos de hoje
    const hoje = new Date().toISOString().split('T')[0];
    const agendamentosHoje = await pool.query(
      'SELECT COUNT(*) FROM agendamentos WHERE data = $1 AND status = $2',
      [hoje, 'agendado']
    );

    // Contar total de agendamentos do mês
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const fimMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];
    const agendamentosMes = await pool.query(
      'SELECT COUNT(*) FROM agendamentos WHERE data >= $1 AND data <= $2',
      [inicioMes, fimMes]
    );

    // Próximos agendamentos (próximos 5)
    const proximosAgendamentos = await pool.query(`
      SELECT a.*, s.nome_servico 
      FROM agendamentos a 
      LEFT JOIN servicos s ON a.servico_id = s.id 
      WHERE a.data >= $1 AND a.status = 'agendado' 
      ORDER BY a.data, a.horario 
      LIMIT 5
    `, [hoje]);

    res.json({
      success: true,
      dashboard: {
        agendamentos_hoje: parseInt(agendamentosHoje.rows[0].count),
        agendamentos_mes: parseInt(agendamentosMes.rows[0].count),
        proximos_agendamentos: proximosAgendamentos.rows
      }
    });

  } catch (error) {
    console.error('Erro ao buscar dados do dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;