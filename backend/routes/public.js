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
    console.log('🕒 Buscando horários para:', data);

    // Buscar configurações do salão
    const configResult = await pool.query(`
      SELECT nome_config, valor FROM configuracao_salao WHERE ativo = true
    `);
    
    const config = {};
    configResult.rows.forEach(row => {
      config[row.nome_config] = row.valor;
    });
    
    console.log('⚙️ Configurações encontradas:', config);

    // Verificar se é dia de funcionamento
    const diaSemana = new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
    const diasMap = {
      'segunda-feira': 'segunda',
      'terça-feira': 'terca',
      'quarta-feira': 'quarta',
      'quinta-feira': 'quinta',
      'sexta-feira': 'sexta',
      'sábado': 'sabado',
      'domingo': 'domingo'
    };
    
    const diaAtual = diasMap[diaSemana];
    console.log('📅 Dia da semana:', diaSemana, '→', diaAtual);
    
    // Se não há configuração de dias de funcionamento, usar padrão (segunda a sábado)
    const diasFuncionamento = config.dias_funcionamento 
      ? config.dias_funcionamento.split(',') 
      : ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    
    console.log('🏢 Dias de funcionamento:', diasFuncionamento);
    
    if (!diasFuncionamento.includes(diaAtual)) {
      console.log('❌ Salão fechado neste dia');
      return res.json({
        success: true,
        data: data,
        horarios_disponiveis: [],
        message: 'Salão fechado neste dia'
      });
    }

    console.log('✅ Salão aberto, gerando horários...');

    // Gerar horários baseados nas configurações
    const horariosBase = gerarHorarios(
      config.horario_abertura || '08:00',
      config.horario_fechamento || '18:00',
      config.intervalo_inicio || '12:00',
      config.intervalo_fim || '13:00',
      parseInt(config.duracao_slot || '30')
    );
    
    console.log('🕐 Horários base gerados:', horariosBase);

    // Buscar agendamentos já existentes para a data
    const agendamentosExistentes = await pool.query(
      'SELECT horario FROM agendamentos WHERE data = $1 AND status = $2',
      [data, 'agendado']
    );
    
    console.log('📋 Agendamentos existentes:', agendamentosExistentes.rows.length);

    // Buscar períodos bloqueados pelo admin para a data
    const horariosBloqueados = await pool.query(`
      SELECT horario_inicio, horario_fim, data_fim 
      FROM horarios_bloqueados 
      WHERE ativo = true 
        AND (
          (data_inicio = $1) OR 
          (data_inicio <= $1 AND (data_fim IS NULL OR data_fim >= $1))
        )
    `, [data]);
    
    console.log('🚫 Bloqueios encontrados:', horariosBloqueados.rows.length);

    const horariosOcupados = agendamentosExistentes.rows.map(row => row.horario);
    
    // Verificar bloqueios de período
    const horariosAdminBloqueados = [];
    horariosBloqueados.rows.forEach(bloqueio => {
      if (bloqueio.horario_fim) {
        // Período com horário de retorno
        const inicio = bloqueio.horario_inicio;
        const fim = bloqueio.horario_fim;
        horariosBase.forEach(horario => {
          if (horario >= inicio && horario < fim) {
            horariosAdminBloqueados.push(horario);
          }
        });
      } else {
        // Bloqueio de horário único
        horariosAdminBloqueados.push(bloqueio.horario_inicio);
      }
    });

    const todosHorariosIndisponiveis = [...horariosOcupados, ...horariosAdminBloqueados];
    console.log('❌ Horários indisponíveis:', todosHorariosIndisponiveis);

    // Filtrar horários disponíveis
    const horariosDisponiveis = horariosBase.filter(horario => {
      return !todosHorariosIndisponiveis.some(indisponivel => indisponivel === horario);
    });
    
    console.log('✅ Horários disponíveis:', horariosDisponiveis);

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

// Função auxiliar para gerar horários
function gerarHorarios(abertura, fechamento, intervaloInicio, intervaloFim, duracaoSlot) {
  const horarios = [];
  
  const [aberturaH, aberturaM] = abertura.split(':').map(n => parseInt(n));
  const [fechamentoH, fechamentoM] = fechamento.split(':').map(n => parseInt(n));
  const [intervaloInicioH, intervaloInicioM] = intervaloInicio.split(':').map(n => parseInt(n));
  const [intervaloFimH, intervaloFimM] = intervaloFim.split(':').map(n => parseInt(n));
  
  const aberturaMinutos = aberturaH * 60 + aberturaM;
  const fechamentoMinutos = fechamentoH * 60 + fechamentoM;
  const intervaloInicioMinutos = intervaloInicioH * 60 + intervaloInicioM;
  const intervaloFimMinutos = intervaloFimH * 60 + intervaloFimM;
  
  for (let minutos = aberturaMinutos; minutos < fechamentoMinutos; minutos += duracaoSlot) {
    // Pular horário de almoço
    if (minutos >= intervaloInicioMinutos && minutos < intervaloFimMinutos) {
      continue;
    }
    
    const horas = Math.floor(minutos / 60);
    const mins = minutos % 60;
    const horarioFormatado = `${horas.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    horarios.push(horarioFormatado);
  }
  
  return horarios;
}

// Rota temporária para testar/configurar horários
router.get('/teste-configuracao', async (req, res) => {
  try {
    console.log('🔧 Rota de teste/configuração chamada');
    
    // Verificar se há configurações
    const configResult = await pool.query(`
      SELECT nome_config, valor FROM configuracao_salao WHERE ativo = true
    `);
    
    console.log('📋 Configurações encontradas:', configResult.rows.length);
    
    // Se não há configurações, criar padrão
    if (configResult.rows.length === 0) {
      console.log('🔧 Criando configurações padrão...');
      
      const configuracoesDefault = [
        ['horario_abertura', '08:00'],
        ['horario_fechamento', '18:00'],
        ['intervalo_inicio', '12:00'],
        ['intervalo_fim', '13:00'],
        ['duracao_slot', '30'],
        ['dias_funcionamento', 'segunda,terca,quarta,quinta,sexta,sabado']
      ];
      
      for (const [nome, valor] of configuracoesDefault) {
        await pool.query(
          `INSERT INTO configuracao_salao (nome_config, valor, ativo) VALUES ($1, $2, true)
           ON CONFLICT (nome_config) DO UPDATE SET valor = EXCLUDED.valor, ativo = true`,
          [nome, valor]
        );
      }
      
      console.log('✅ Configurações padrão criadas');
    }
    
    // Buscar configurações atualizadas
    const configAtualizadas = await pool.query(`
      SELECT nome_config, valor FROM configuracao_salao WHERE ativo = true
    `);
    
    const config = {};
    configAtualizadas.rows.forEach(row => {
      config[row.nome_config] = row.valor;
    });
    
    // Testar geração de horários
    const horariosGerados = gerarHorarios(
      config.horario_abertura || '08:00',
      config.horario_fechamento || '18:00', 
      config.intervalo_inicio || '12:00',
      config.intervalo_fim || '13:00',
      parseInt(config.duracao_slot || '30')
    );
    
    console.log('⏰ Horários gerados:', horariosGerados);
    
    res.json({
      success: true,
      message: 'Teste de configuração executado',
      configuracoes: config,
      horarios_gerados: horariosGerados,
      total_horarios: horariosGerados.length
    });
    
  } catch (error) {
    console.error('❌ Erro no teste de configuração:', error);
    res.status(500).json({
      success: false,
      message: 'Erro no teste',
      error: error.message
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