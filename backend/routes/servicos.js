const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const router = express.Router();

// Middleware de autenticação (importado do admin.js)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token de acesso requerido' 
    });
  }

  const jwt = require('jsonwebtoken');
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Token inválido' 
      });
    }
    req.user = user;
    next();
  });
}

// ===== GESTÃO DE SERVIÇOS =====

// Listar todos os serviços
router.get('/servicos', authenticateToken, async (req, res) => {
  try {
    const { ativo } = req.query;
    
    let query = 'SELECT * FROM servicos';
    let params = [];
    
    if (ativo !== undefined) {
      query += ' WHERE ativo = $1';
      params.push(ativo === 'true');
    }
    
    query += ' ORDER BY nome_servico ASC';
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      servicos: result.rows
    });
    
  } catch (error) {
    console.error('Erro ao listar serviços:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Obter serviço por ID
router.get('/servicos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('SELECT * FROM servicos WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Serviço não encontrado'
      });
    }
    
    res.json({
      success: true,
      servico: result.rows[0]
    });
    
  } catch (error) {
    console.error('Erro ao obter serviço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Criar novo serviço
router.post('/servicos', [
  authenticateToken,
  body('nome_servico').notEmpty().trim().withMessage('Nome do serviço é obrigatório'),
  body('preco').isFloat({ min: 0 }).withMessage('Preço deve ser um número válido maior que zero'),
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
    
    const { nome_servico, preco, duracao = 60, ativo = true } = req.body;
    
    // Verificar se já existe um serviço com esse nome
    const existingService = await pool.query(
      'SELECT id FROM servicos WHERE LOWER(nome_servico) = LOWER($1)',
      [nome_servico]
    );
    
    if (existingService.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Já existe um serviço com esse nome'
      });
    }
    
    const result = await pool.query(
      `INSERT INTO servicos (nome_servico, preco, duracao, ativo) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [nome_servico, preco, duracao, ativo]
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

// Atualizar serviço
router.put('/servicos/:id', [
  authenticateToken,
  body('nome_servico').optional().notEmpty().trim().withMessage('Nome do serviço não pode estar vazio'),
  body('preco').optional().isFloat({ min: 0 }).withMessage('Preço deve ser um número válido maior que zero'),
  body('duracao').optional().isInt({ min: 1 }).withMessage('Duração deve ser um número inteiro positivo'),
  body('ativo').optional().isBoolean().withMessage('Ativo deve ser verdadeiro ou falso')
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
    
    // Verificar se o serviço existe
    const existingService = await pool.query('SELECT * FROM servicos WHERE id = $1', [id]);
    
    if (existingService.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Serviço não encontrado'
      });
    }
    
    // Se está alterando o nome, verificar duplicatas
    if (nome_servico && nome_servico !== existingService.rows[0].nome_servico) {
      const duplicateCheck = await pool.query(
        'SELECT id FROM servicos WHERE LOWER(nome_servico) = LOWER($1) AND id != $2',
        [nome_servico, id]
      );
      
      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Já existe outro serviço com esse nome'
        });
      }
    }
    
    // Construir query de update dinamicamente
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (nome_servico !== undefined) {
      updates.push(`nome_servico = $${paramCount}`);
      values.push(nome_servico);
      paramCount++;
    }
    
    if (preco !== undefined) {
      updates.push(`preco = $${paramCount}`);
      values.push(preco);
      paramCount++;
    }
    
    if (duracao !== undefined) {
      updates.push(`duracao = $${paramCount}`);
      values.push(duracao);
      paramCount++;
    }
    
    if (ativo !== undefined) {
      updates.push(`ativo = $${paramCount}`);
      values.push(ativo);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum campo fornecido para atualização'
      });
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    
    const query = `UPDATE servicos SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await pool.query(query, values);
    
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

// Desativar/Ativar serviço
router.patch('/servicos/:id/toggle', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE servicos 
       SET ativo = NOT ativo, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Serviço não encontrado'
      });
    }
    
    const servico = result.rows[0];
    
    res.json({
      success: true,
      message: `Serviço ${servico.ativo ? 'ativado' : 'desativado'} com sucesso`,
      servico
    });
    
  } catch (error) {
    console.error('Erro ao alterar status do serviço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Excluir serviço (soft delete)
router.delete('/servicos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar se há agendamentos usando este serviço
    const agendamentosCount = await pool.query(
      'SELECT COUNT(*) as count FROM agendamentos WHERE servico_id = $1',
      [id]
    );
    
    if (parseInt(agendamentosCount.rows[0].count) > 0) {
      // Se há agendamentos, apenas desativar
      const result = await pool.query(
        `UPDATE servicos 
         SET ativo = false, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1 
         RETURNING *`,
        [id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Serviço não encontrado'
        });
      }
      
      return res.json({
        success: true,
        message: 'Serviço desativado (há agendamentos vinculados)',
        servico: result.rows[0]
      });
    }
    
    // Se não há agendamentos, pode excluir completamente
    const result = await pool.query(
      'DELETE FROM servicos WHERE id = $1 RETURNING *',
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
      message: 'Serviço excluído com sucesso'
    });
    
  } catch (error) {
    console.error('Erro ao excluir serviço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Estatísticas de serviços
router.get('/servicos/stats/overview', authenticateToken, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_servicos,
        COUNT(*) FILTER (WHERE ativo = true) as servicos_ativos,
        COUNT(*) FILTER (WHERE ativo = false) as servicos_inativos,
        AVG(preco) as preco_medio,
        MIN(preco) as preco_minimo,
        MAX(preco) as preco_maximo
      FROM servicos
    `);
    
    const servicosMaisUsados = await pool.query(`
      SELECT 
        s.id,
        s.nome_servico,
        s.preco,
        COUNT(a.id) as total_agendamentos
      FROM servicos s
      LEFT JOIN agendamentos a ON s.id = a.servico_id
      WHERE s.ativo = true
      GROUP BY s.id, s.nome_servico, s.preco
      ORDER BY total_agendamentos DESC
      LIMIT 5
    `);
    
    res.json({
      success: true,
      stats: stats.rows[0],
      servicos_mais_usados: servicosMaisUsados.rows
    });
    
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;