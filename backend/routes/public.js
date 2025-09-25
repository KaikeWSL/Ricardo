const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const router = express.Router();

// Validações para agendamento
const validarAgendamento = [
  body('nome_cliente').trim().isLength({ min: 2, max: 100 }).withMessage('Nome deve ter entre 2 e 100 caracteres'),
  body('telefone').trim().matches(/^\(\d{2}\)\s\d{4,5}-\d{4}$/).withMessage('Formato de telefone inválido. Use: (11) 99999-9999'),
  body('data').isISO8601().withMessage('Data inválida'),
  body('horario').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Horário inválido'),
  body('servico_id').isInt({ min: 1 }).withMessage('Serviço inválido')
];

// POST /api/agendar - Criar novo agendamento
router.post('/agendar', validarAgendamento, async (req, res) => {
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

    const { nome_cliente, telefone, data, horario, servico_id, observacoes } = req.body;

    // Verificar se o horário já está ocupado
    const conflito = await pool.query(
      'SELECT id FROM agendamentos WHERE data = $1 AND horario = $2 AND status = $3',
      [data, horario, 'agendado']
    );

    if (conflito.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Este horário já está ocupado. Por favor, escolha outro horário.'
      });
    }

    // Verificar se o serviço existe
    const servicoExiste = await pool.query('SELECT id FROM servicos WHERE id = $1 AND ativo = true', [servico_id]);
    if (servicoExiste.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Serviço não encontrado ou inativo'
      });
    }

    // Verificar se a data não é no passado
    const dataAgendamento = new Date(data + 'T' + horario);
    const agora = new Date();
    
    if (dataAgendamento <= agora) {
      return res.status(400).json({
        success: false,
        message: 'Não é possível agendar para datas passadas'
      });
    }

    // Criar o agendamento
    const novoAgendamento = await pool.query(
      'INSERT INTO agendamentos (nome_cliente, telefone, data, horario, servico_id, observacoes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [nome_cliente, telefone, data, horario, servico_id, observacoes || null]
    );

    res.status(201).json({
      success: true,
      message: 'Agendamento realizado com sucesso!',
      agendamento: novoAgendamento.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/horarios-disponiveis - Verificar horários disponíveis para uma data
router.get('/horarios-disponiveis/:data', async (req, res) => {
  try {
    const { data } = req.params;

    // Horários de funcionamento (8h às 18h, intervalos de 30min)
    const horariosBase = [
      '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
      '11:00', '11:30', '14:00', '14:30', '15:00', '15:30',
      '16:00', '16:30', '17:00', '17:30'
    ];

    // Buscar agendamentos já existentes para a data
    const agendamentosExistentes = await pool.query(
      'SELECT horario FROM agendamentos WHERE data = $1 AND status = $2',
      [data, 'agendado']
    );

    const horariosOcupados = agendamentosExistentes.rows.map(row => row.horario);

    // Filtrar horários disponíveis
    const horariosDisponiveis = horariosBase.filter(horario => {
      return !horariosOcupados.some(ocupado => ocupado === horario);
    });

    res.json({
      success: true,
      data: data,
      horarios_disponiveis: horariosDisponiveis
    });

  } catch (error) {
    console.error('Erro ao buscar horários disponíveis:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/servicos - Listar serviços ativos
router.get('/servicos', async (req, res) => {
  try {
    console.log('🔍 Tentando buscar serviços...');
    console.log('🔍 DATABASE_URL configurada:', !!process.env.DATABASE_URL);
    
    const servicos = await pool.query('SELECT * FROM servicos WHERE ativo = true ORDER BY nome_servico');
    
    console.log('✅ Serviços encontrados:', servicos.rows.length);
    
    res.json({
      success: true,
      servicos: servicos.rows
    });

  } catch (error) {
    console.error('❌ Erro detalhado ao buscar serviços:', error);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
    });
  }
});

module.exports = router;