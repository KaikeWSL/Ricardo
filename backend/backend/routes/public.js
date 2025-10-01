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

    console.log('📝 Tentativa de agendamento:', {
      cliente: nome_cliente,
      telefone: telefone,
      data: data,
      horario: horario,
      servico_id: servico_id
    });

    // VERIFICAÇÃO RIGOROSA DE CONFLITO DE HORÁRIO
    const conflito = await pool.query(`
      SELECT id, nome_cliente, telefone, status, created_at
      FROM agendamentos 
      WHERE data = $1 AND horario = $2 AND (status = 'agendado' OR status = 'confirmado')
    `, [data, horario]);

    if (conflito.rows.length > 0) {
      const agendamentoExistente = conflito.rows[0];
      console.log('❌ CONFLITO DETECTADO:', {
        horario_solicitado: `${data} ${horario}`,
        agendamento_existente: agendamentoExistente.id,
        cliente_existente: agendamentoExistente.nome_cliente,
        status: agendamentoExistente.status,
        criado_em: agendamentoExistente.created_at
      });
      
      return res.status(400).json({
        success: false,
        message: `Este horário já está ocupado por ${agendamentoExistente.nome_cliente}. Por favor, escolha outro horário.`,
        conflito: {
          data: data,
          horario: horario,
          cliente_existente: agendamentoExistente.nome_cliente
        }
      });
    }

    // Verificar bloqueios administrativos
    const bloqueio = await pool.query(`
      SELECT id, motivo, horario_inicio, horario_fim
      FROM horarios_bloqueados 
      WHERE ativo = true 
        AND data_inicio <= $1 
        AND (data_fim IS NULL OR data_fim >= $1)
        AND (
          (horario_fim IS NULL AND horario_inicio = $2) OR
          (horario_fim IS NOT NULL AND $2 >= horario_inicio AND $2 < horario_fim)
        )
    `, [data, horario]);

    if (bloqueio.rows.length > 0) {
      const bloqueioExistente = bloqueio.rows[0];
      console.log('❌ BLOQUEIO ADMINISTRATIVO DETECTADO:', bloqueioExistente);
      
      return res.status(400).json({
        success: false,
        message: `Este horário está bloqueado: ${bloqueioExistente.motivo || 'Horário não disponível'}`,
        bloqueio: bloqueioExistente
      });
    }

    // Verificar se o serviço existe e está ativo
    const servicoExiste = await pool.query('SELECT id, nome_servico, preco FROM servicos WHERE id = $1 AND ativo = true', [servico_id]);
    if (servicoExiste.rows.length === 0) {
      console.log('❌ Serviço não encontrado:', servico_id);
      return res.status(400).json({
        success: false,
        message: 'Serviço não encontrado ou inativo'
      });
    }

    const servico = servicoExiste.rows[0];
    console.log('✅ Serviço válido:', servico);

    // Verificar se a data não é no passado (com margem de 15 minutos)
    const dataAgendamento = new Date(data + 'T' + horario);
    const agora = new Date();
    const margemMinutos = 15; // Permitir agendamento até 15 minutos no passado
    const agoraComMargem = new Date(agora.getTime() - margemMinutos * 60 * 1000);
    
    console.log('🕐 Verificação de data:', {
      data: data,
      horario: horario,
      dataAgendamento: dataAgendamento.toISOString(),
      agora: agora.toISOString(),
      agoraComMargem: agoraComMargem.toISOString(),
      ePassado: dataAgendamento <= agoraComMargem
    });
    
    if (dataAgendamento <= agoraComMargem) {
      console.log('❌ Tentativa de agendar no passado');
      return res.status(400).json({
        success: false,
        message: 'Não é possível agendar para datas passadas'
      });
    }

    // CRIAR O AGENDAMENTO COM LOG DETALHADO
    console.log('💾 Criando agendamento no banco de dados...');
    const novoAgendamento = await pool.query(
      'INSERT INTO agendamentos (nome_cliente, telefone, data, horario, servico_id, observacoes, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *',
      [nome_cliente, telefone, data, horario, servico_id, observacoes || null, 'agendado']
    );

    const agendamentoCriado = novoAgendamento.rows[0];
    console.log('✅ AGENDAMENTO CRIADO COM SUCESSO:', {
      id: agendamentoCriado.id,
      cliente: agendamentoCriado.nome_cliente,
      data_horario: `${agendamentoCriado.data} ${agendamentoCriado.horario}`,
      servico_id: agendamentoCriado.servico_id,
      status: agendamentoCriado.status,
      created_at: agendamentoCriado.created_at
    });

    // Verificar se realmente foi inserido
    const verificacao = await pool.query(
      'SELECT * FROM agendamentos WHERE id = $1',
      [agendamentoCriado.id]
    );
    
    console.log('🔍 Verificação pós-inserção:', verificacao.rows[0]);

    res.status(201).json({
      success: true,
      message: 'Agendamento realizado com sucesso!',
      agendamento: {
        ...agendamentoCriado,
        servico_nome: servico.nome_servico,
        servico_preco: servico.preco
      }
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
    const diasFuncionamentoBruto = config.dias_funcionamento || config.dias_semana || 'segunda,terca,quarta,quinta,sexta,sabado';
    const diasFuncionamento = diasFuncionamentoBruto.split(',').map(d => d.trim());
    
    console.log('🏢 Dias de funcionamento configurados:', diasFuncionamentoBruto);
    console.log('🏢 Dias de funcionamento array:', diasFuncionamento);
    console.log('🔍 Verificando se', diaAtual, 'está em', diasFuncionamento);
    console.log('📝 Inclui dia atual?', diasFuncionamento.includes(diaAtual));
    
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

    // Garantir compatibilidade com diferentes nomes de configuração
    const horarioAbertura = config.horario_abertura || config.hora_abertura || '08:00';
    const horarioFechamento = config.horario_fechamento || config.hora_fechamento || '18:00';
    const intervaloInicio = config.intervalo_inicio || config.almoco_inicio || '12:00';
    const intervaloFim = config.intervalo_fim || config.almoco_fim || '13:00';
    const duracaoSlot = parseInt(config.duracao_slot || '30');
    
    console.log('🕐 Configurações aplicadas:', {
      abertura: horarioAbertura,
      fechamento: horarioFechamento,
      intervalo: `${intervaloInicio}-${intervaloFim}`,
      slot: duracaoSlot
    });

    // Gerar horários baseados nas configurações
    const horariosBase = gerarHorarios(
      horarioAbertura,
      horarioFechamento,
      intervaloInicio,
      intervaloFim,
      duracaoSlot
    );
    console.log('🕐 Horários base gerados:', horariosBase);

    // VERIFICAÇÃO DETALHADA DE AGENDAMENTOS EXISTENTES
    const agendamentosExistentes = await pool.query(`
      SELECT horario, nome_cliente, id, status 
      FROM agendamentos 
      WHERE data = $1 AND (status = 'agendado' OR status = 'confirmado')
      ORDER BY horario
    `, [data]);
    
    console.log('📋 Agendamentos existentes para', data + ':', agendamentosExistentes.rows.length);
    agendamentosExistentes.rows.forEach(agendamento => {
      console.log(`   - ${agendamento.horario}: ${agendamento.nome_cliente} (ID: ${agendamento.id}, Status: ${agendamento.status})`);
    });

    // VERIFICAÇÃO DETALHADA DE BLOQUEIOS
    const horariosBloqueados = await pool.query(`
      SELECT horario_inicio, horario_fim, data_fim, motivo, id
      FROM horarios_bloqueados 
      WHERE ativo = true 
        AND (
          (data_inicio = $1) OR 
          (data_inicio <= $1 AND (data_fim IS NULL OR data_fim >= $1))
        )
      ORDER BY horario_inicio
    `, [data]);
    
    console.log('🚫 Bloqueios encontrados para', data + ':', horariosBloqueados.rows.length);
    horariosBloqueados.rows.forEach(bloqueio => {
      console.log(`   - ${bloqueio.horario_inicio}${bloqueio.horario_fim ? ' até ' + bloqueio.horario_fim : ''}: ${bloqueio.motivo || 'Sem motivo'} (ID: ${bloqueio.id})`);
    });

    // Extrair horários ocupados por agendamentos
    const horariosOcupados = agendamentosExistentes.rows.map(row => row.horario);
    console.log('🔴 Horários ocupados por agendamentos:', horariosOcupados);
    
    // Processar bloqueios administrativos
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
        console.log(`   - Bloqueio de período ${inicio} a ${fim} afeta: ${horariosBase.filter(h => h >= inicio && h < fim).join(', ')}`);
      } else {
        // Bloqueio de horário único
        horariosAdminBloqueados.push(bloqueio.horario_inicio);
        console.log(`   - Bloqueio único: ${bloqueio.horario_inicio}`);
      }
    });
    
    console.log('🟠 Horários bloqueados administrativamente:', horariosAdminBloqueados);

    // Consolidar todos os horários indisponíveis
    const todosHorariosIndisponiveis = [...new Set([...horariosOcupados, ...horariosAdminBloqueados])];
    console.log('❌ TODOS os horários indisponíveis:', todosHorariosIndisponiveis);

    // Filtrar horários disponíveis com log detalhado
    const horariosDisponiveis = horariosBase.filter(horario => {
      const disponivel = !todosHorariosIndisponiveis.includes(horario);
      console.log(`   🕐 ${horario}: ${disponivel ? '✅ DISPONÍVEL' : '❌ OCUPADO'}`);
      return disponivel;
    });
    
    console.log('✅ RESULTADO FINAL - Horários disponíveis:', horariosDisponiveis);
    console.log('📊 ESTATÍSTICAS:');
    console.log(`   - Total de slots: ${horariosBase.length}`);
    console.log(`   - Agendamentos: ${horariosOcupados.length}`);
    console.log(`   - Bloqueios admin: ${horariosAdminBloqueados.length}`);
    console.log(`   - Disponíveis: ${horariosDisponiveis.length}`);

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
    
    // Corrigir nomes de configurações se necessário
    const configsParaCorrigir = [
      { antigo: 'hora_abertura', novo: 'horario_abertura' },
      { antigo: 'hora_fechamento', novo: 'horario_fechamento' },
      { antigo: 'almoco_inicio', novo: 'intervalo_inicio' },
      { antigo: 'almoco_fim', novo: 'intervalo_fim' }
    ];
    
    for (const { antigo, novo } of configsParaCorrigir) {
      const configAntiga = await pool.query(
        'SELECT valor FROM configuracao_salao WHERE nome_config = $1 AND ativo = true',
        [antigo]
      );
      
      if (configAntiga.rows.length > 0) {
        console.log(`🔄 Migrando ${antigo} → ${novo}: ${configAntiga.rows[0].valor}`);
        
        // Criar/atualizar com nome correto
        await pool.query(
          `INSERT INTO configuracao_salao (nome_config, valor, ativo) VALUES ($1, $2, true)
           ON CONFLICT (nome_config) DO UPDATE SET valor = EXCLUDED.valor, ativo = true`,
          [novo, configAntiga.rows[0].valor]
        );
        
        // Desativar o antigo
        await pool.query(
          'UPDATE configuracao_salao SET ativo = false WHERE nome_config = $1',
          [antigo]
        );
      }
    }
    
    // Corrigir formato dos dias de funcionamento se estiver como array JSON
    const diasFuncionamentoAtual = await pool.query(
      'SELECT valor FROM configuracao_salao WHERE nome_config = $1 AND ativo = true',
      ['dias_funcionamento']
    );
    
    if (diasFuncionamentoAtual.rows.length > 0) {
      const valorAtual = diasFuncionamentoAtual.rows[0].valor;
      console.log('🔍 Verificando formato dias_funcionamento:', valorAtual);
      
      // Se está no formato de array JSON, converter para string
      if (valorAtual.startsWith('[') && valorAtual.includes('true')) {
        console.log('🔧 Convertendo formato de dias_funcionamento...');
        
        // Converter [true,true,true,true,true,true,false] para "segunda,terca,quarta,quinta,sexta,sabado"
        const diasCorretos = 'segunda,terca,quarta,quinta,sexta,sabado';
        
        await pool.query(
          `UPDATE configuracao_salao SET valor = $1 WHERE nome_config = $2 AND ativo = true`,
          [diasCorretos, 'dias_funcionamento']
        );
        
        console.log('✅ Formato dias_funcionamento corrigido para:', diasCorretos);
      }
    }
    
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
    
    // Garantir compatibilidade com diferentes nomes de configuração
    const horarioAbertura = config.horario_abertura || config.hora_abertura || '08:00';
    const horarioFechamento = config.horario_fechamento || config.hora_fechamento || '18:00';
    const intervaloInicio = config.intervalo_inicio || config.almoco_inicio || '12:00';
    const intervaloFim = config.intervalo_fim || config.almoco_fim || '13:00';
    const duracaoSlot = parseInt(config.duracao_slot || '30');
    
    console.log('🕐 Usando configurações:', {
      abertura: horarioAbertura,
      fechamento: horarioFechamento,
      intervalo: `${intervaloInicio}-${intervaloFim}`,
      slot: duracaoSlot
    });
    
    // Testar geração de horários
    const horariosGerados = gerarHorarios(
      horarioAbertura,
      horarioFechamento, 
      intervaloInicio,
      intervaloFim,
      duracaoSlot
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

// Rota de debug para verificar estado das tabelas
router.get('/debug-tabelas/:data?', async (req, res) => {
  try {
    const data = req.params.data || new Date().toISOString().split('T')[0];
    console.log('🔍 DEBUG - Verificando tabelas para data:', data);
    
    // 1. Verificar configurações
    const configuracoes = await pool.query('SELECT * FROM configuracao_salao WHERE ativo = true ORDER BY nome_config');
    
    // 2. Verificar agendamentos para a data
    const agendamentos = await pool.query(`
      SELECT a.*, s.nome_servico 
      FROM agendamentos a 
      LEFT JOIN servicos s ON a.servico_id = s.id 
      WHERE a.data = $1 
      ORDER BY a.horario
    `, [data]);
    
    // 3. Verificar bloqueios para a data
    const bloqueios = await pool.query(`
      SELECT * FROM horarios_bloqueados 
      WHERE ativo = true 
        AND data_inicio <= $1 
        AND (data_fim IS NULL OR data_fim >= $1)
      ORDER BY horario_inicio
    `, [data]);
    
    // 4. Verificar serviços
    const servicos = await pool.query('SELECT * FROM servicos WHERE ativo = true ORDER BY nome_servico');
    
    // 5. Verificar estrutura das tabelas
    const estruturaAgendamentos = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'agendamentos' 
      ORDER BY ordinal_position
    `);
    
    const result = {
      success: true,
      data_consultada: data,
      resumo: {
        configuracoes: configuracoes.rows.length,
        agendamentos: agendamentos.rows.length,
        bloqueios: bloqueios.rows.length,
        servicos: servicos.rows.length
      },
      detalhes: {
        configuracoes: configuracoes.rows,
        agendamentos: agendamentos.rows,
        bloqueios: bloqueios.rows,
        servicos: servicos.rows,
        estrutura_agendamentos: estruturaAgendamentos.rows
      }
    };
    
    console.log('📊 ESTADO DAS TABELAS:', {
      data: data,
      configuracoes: configuracoes.rows.length,
      agendamentos: agendamentos.rows.length,
      agendamentos_detalhes: agendamentos.rows.map(a => `${a.horario} - ${a.nome_cliente} (${a.status})`),
      bloqueios: bloqueios.rows.length,
      servicos: servicos.rows.length
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Erro no debug:', error);
    res.status(500).json({
      success: false,
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

// Rota de debug para verificar agendamentos em tempo real
router.get('/debug-agendamentos/:data?', async (req, res) => {
  try {
    const { data } = req.params;
    const dataFilter = data || new Date().toISOString().split('T')[0];
    
    console.log('🔍 Debug: Verificando agendamentos para', dataFilter);
    
    // Buscar todos os agendamentos para a data
    const agendamentos = await pool.query(`
      SELECT 
        id, nome_cliente, telefone, data, horario, 
        servico_id, status, observacoes, created_at, updated_at
      FROM agendamentos 
      WHERE data = $1 
      ORDER BY horario ASC
    `, [dataFilter]);
    
    // Buscar também horários bloqueados
    const bloqueios = await pool.query(`
      SELECT 
        id, data_inicio, data_fim, horario_inicio, horario_fim, 
        motivo, ativo, created_at
      FROM horarios_bloqueados 
      WHERE data_inicio <= $1 AND (data_fim IS NULL OR data_fim >= $1)
        AND ativo = true
      ORDER BY horario_inicio ASC
    `, [dataFilter]);
    
    // Buscar serviços para referência
    const servicos = await pool.query('SELECT id, nome FROM servicos ORDER BY id');
    
    const servicosMap = {};
    servicos.rows.forEach(s => servicosMap[s.id] = s.nome);
    
    console.log('📊 Debug resultados:', {
      data: dataFilter,
      agendamentos: agendamentos.rows.length,
      bloqueios: bloqueios.rows.length
    });
    
    res.json({
      success: true,
      data: dataFilter,
      agendamentos: agendamentos.rows.map(ag => ({
        ...ag,
        servico_nome: servicosMap[ag.servico_id] || 'Serviço não encontrado'
      })),
      bloqueios: bloqueios.rows,
      servicos: servicosMap,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erro no debug de agendamentos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro no debug',
      error: error.message
    });
  }
});

module.exports = router;