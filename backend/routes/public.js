const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const crypto = require('crypto');
const AsaasPixService = require('../services/AsaasPixService');
const router = express.Router();

// Inicializar serviço de pagamento Asaas
const asaasService = new AsaasPixService();

// Função utilitária para obter data/hora do Brasil (UTC-3)
function getBrazilDateTime() {
  const now = new Date();
  const brasilOffset = -3 * 60; // UTC-3 em minutos
  const nowBrasil = new Date(now.getTime() + (brasilOffset * 60000));
  
  return {
    date: nowBrasil.toISOString().split('T')[0],
    time: nowBrasil.toISOString().split('T')[1].split('.')[0],
    fullDate: nowBrasil
  };
}

// Configurações PIX do estabelecimento
const PIX_CONFIG = {
  merchantName: 'RICARDO CABELEREIRO',
  merchantCity: 'SAO PAULO',
  pixKey: '11987108126', // Chave PIX real do barbeiro
  merchantCategoryCode: '9602', // Categoria para serviços de beleza
  countryCode: 'BR',
  currency: '986' // Real brasileiro
};

// Função para gerar código EMV PIX real (padrão Banco Central)
function gerarCodigoEMVPix(valor, txid, descricao) {
  // Função para formatar campo EMV
  function formatEMVField(id, value) {
    const length = value.length.toString().padStart(2, '0');
    return id + length + value;
  }

  // Função para calcular CRC16
  function calculateCRC16(data) {
    const polynomial = 0x1021;
    let crc = 0xFFFF;
    
    for (let i = 0; i < data.length; i++) {
      crc ^= (data.charCodeAt(i) << 8);
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ polynomial;
        } else {
          crc = crc << 1;
        }
        crc &= 0xFFFF;
      }
    }
    
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // Construir payload EMV
  let payload = '';
  
  // Payload Format Indicator
  payload += formatEMVField('00', '01');
  
  // Point of Initiation Method (dinâmico)
  payload += formatEMVField('01', '12');
  
  // Merchant Account Information (PIX)
  let merchantInfo = '';
  merchantInfo += formatEMVField('00', 'BR.GOV.BCB.PIX');
  merchantInfo += formatEMVField('01', PIX_CONFIG.pixKey);
  if (descricao) {
    merchantInfo += formatEMVField('02', descricao);
  }
  payload += formatEMVField('26', merchantInfo);
  
  // Merchant Category Code
  payload += formatEMVField('52', PIX_CONFIG.merchantCategoryCode);
  
  // Transaction Currency
  payload += formatEMVField('53', PIX_CONFIG.currency);
  
  // Transaction Amount
  payload += formatEMVField('54', valor);
  
  // Country Code
  payload += formatEMVField('58', PIX_CONFIG.countryCode);
  
  // Merchant Name
  payload += formatEMVField('59', PIX_CONFIG.merchantName);
  
  // Merchant City
  payload += formatEMVField('60', PIX_CONFIG.merchantCity);
  
  // Additional Data Field Template (txid)
  if (txid) {
    let additionalData = formatEMVField('05', txid);
    payload += formatEMVField('62', additionalData);
  }
  
  // CRC16 (placeholder)
  payload += '6304';
  
  // Calcular e adicionar CRC16 real
  const crc = calculateCRC16(payload);
  payload = payload.slice(0, -4) + crc;
  
  return payload;
}

// Função para gerar dados do PIX de garantia (com opção de API bancária)
async function gerarPixGarantia(agendamentoId, nomeCliente, telefone) {
  const valor = '5.00';
  const descricao = `Taxa garantia agendamento ${agendamentoId}`;
  
  // USAR APENAS ASAAS - SISTEMA SIMPLIFICADO
  if (!process.env.ASAAS_API_KEY) {
    throw new Error('Chave API do Asaas não configurada');
  }

  try {
    console.log('🇧🇷 Gerando PIX via Asaas...');
    
    const dadosCobranca = {
      valor: valor,
      descricao: descricao,
      external_reference: `AGD${agendamentoId}`,
      chave_pix: process.env.PIX_KEY || PIX_CONFIG.pixKey,
      cliente: {
        nome: nomeCliente,
        telefone: telefone.replace(/\D/g, ''), // Remove formatação
        email: `cliente${agendamentoId}@agendamento.com`
      }
    };

    const cobrancaAsaas = await asaasService.criarCobrancaPix(dadosCobranca);
    
    return {
      tipo: 'asaas',
      chave: process.env.PIX_KEY || PIX_CONFIG.pixKey,
      valor: valor,
      codigo: cobrancaAsaas.qrCode?.payload,
      qrCodeBase64: cobrancaAsaas.qrCode?.encodedImage,
      qrCodeUrl: `data:image/png;base64,${cobrancaAsaas.qrCode?.encodedImage}`,
      descricao: descricao,
      agendamento_id: agendamentoId,
      payment_id: cobrancaAsaas.id,
      external_reference: cobrancaAsaas.externalReference,
      invoice_url: cobrancaAsaas.invoiceUrl,
      merchantName: PIX_CONFIG.merchantName,
      validade: cobrancaAsaas.qrCode?.expirationDate || new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

  } catch (error) {
    console.error('❌ Erro na API do Asaas:', error);
    throw new Error(`Erro ao gerar PIX: ${error.message}`);
  }
}

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
    const brazilNow = getBrazilDateTime();
    const agora = brazilNow.fullDate;
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

    // CRIAR O AGENDAMENTO PENDENTE DE PAGAMENTO
    console.log('💾 Criando agendamento pendente de pagamento...');
    const novoAgendamento = await pool.query(
      'INSERT INTO agendamentos (nome_cliente, telefone, data, horario, servico_id, observacoes, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *',
      [nome_cliente, telefone, data, horario, servico_id, observacoes || null, 'pendente_pagamento']
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

    // GERAR DADOS DO PIX DE R$ 5,00
    const pixData = await gerarPixGarantia(agendamentoCriado.id, nome_cliente, telefone);
    console.log('💰 PIX gerado para garantia:', pixData);

    // SALVAR DADOS DO PIX NA TABELA DE CONTROLE - APENAS SE A TABELA EXISTIR
    try {
      await pool.query(
        `INSERT INTO pagamentos_pix (
          agendamento_id, pix_id, valor, qr_code, emv_code, 
          provider, provider_payment_id, status, customer_data, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          agendamentoCriado.id,
          pixData.txid || pixData.external_reference || `AGD${agendamentoCriado.id}`,
          parseFloat(pixData.valor),
          pixData.qrCodeUrl || pixData.qrCodeBase64 || '',
          pixData.codigo || '',
          'asaas', // Sempre Asaas
          pixData.payment_id || null,
          'pending',
          JSON.stringify({
            nome: nome_cliente,
            telefone: telefone,
            agendamento_id: agendamentoCriado.id
          }),
          new Date(Date.now() + 15 * 60 * 1000) // Expira em 15 minutos
        ]
      );
    } catch (pixError) {
      console.error('⚠️ Erro ao salvar PIX (tabela pode não existir):', pixError.message);
      // Continuar mesmo com erro no PIX - isso permite testar o agendamento básico
    }

    res.status(201).json({
      success: true,
      message: 'Agendamento criado! Complete o pagamento da taxa de garantia.',
      requiresPayment: true,
      agendamento: {
        ...agendamentoCriado,
        servico_nome: servico.nome_servico,
        servico_preco: servico.preco
      },
      pix: pixData
    });

  } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/confirmar-pagamento - Confirmar pagamento da taxa de garantia
router.post('/confirmar-pagamento', async (req, res) => {
  try {
    const { agendamento_id, comprovante_base64 } = req.body;

    if (!agendamento_id || !comprovante_base64) {
      return res.status(400).json({
        success: false,
        message: 'ID do agendamento e comprovante são obrigatórios'
      });
    }

    // Verificar se o agendamento existe e está pendente
    const agendamento = await pool.query(
      'SELECT * FROM agendamentos WHERE id = $1 AND status = $2',
      [agendamento_id, 'pendente_pagamento']
    );

    if (agendamento.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Agendamento não encontrado ou já processado'
      });
    }

    // Verificar se existe PIX pendente para este agendamento
    const pixPendente = await pool.query(
      'SELECT * FROM pagamentos_pix WHERE agendamento_id = $1 AND status = $2',
      [agendamento_id, 'pending']
    );

    if (pixPendente.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum PIX pendente encontrado para este agendamento'
      });
    }

    // Gerar end-to-end ID simulado (na prática viria da API do banco)
    const endToEndId = `E${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Atualizar status do PIX para 'pago'
    await pool.query(
      'UPDATE pagamentos_pix SET status = $1, end_to_end_id = $2, data_pagamento = NOW() WHERE agendamento_id = $3',
      ['pago', endToEndId, agendamento_id]
    );

    // Atualizar status do agendamento para 'agendado' e salvar comprovante
    const resultado = await pool.query(
      'UPDATE agendamentos SET status = $1, comprovante_pagamento = $2, data_pagamento = NOW() WHERE id = $3 RETURNING *',
      ['agendado', comprovante_base64, agendamento_id]
    );

    console.log('✅ Pagamento confirmado para agendamento:', agendamento_id);
    console.log('💰 End-to-End ID:', endToEndId);

    res.json({
      success: true,
      message: 'Pagamento confirmado! Seu agendamento foi efetivado.',
      agendamento: resultado.rows[0],
      endToEndId: endToEndId
    });

  } catch (error) {
    console.error('❌ Erro ao confirmar pagamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/verificar-pagamento/:agendamento_id - Verificar status do pagamento
router.get('/verificar-pagamento/:agendamento_id', async (req, res) => {
  try {
    const { agendamento_id } = req.params;

    // Buscar informações do pagamento
    const resultado = await pool.query(`
      SELECT 
        p.*,
        a.nome_cliente,
        a.status as agendamento_status
      FROM pagamentos_pix p
      JOIN agendamentos a ON p.agendamento_id = a.id
      WHERE p.agendamento_id = $1
      ORDER BY p.created_at DESC
      LIMIT 1
    `, [agendamento_id]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pagamento não encontrado'
      });
    }

    const pagamento = resultado.rows[0];

    // Se tem payment_id_externo, consultar API para status atualizado
    if (pagamento.payment_id_externo && pagamento.tipo_pix !== 'local') {
      try {
        let statusAtualizado;
        
        if (pagamento.tipo_pix === 'asaas') {
          const consultaAsaas = await asaasService.consultarCobranca(pagamento.payment_id_externo);
          statusAtualizado = asaasService.mapStatus(consultaAsaas.status);
          
          // Atualizar no banco se mudou
          if (statusAtualizado !== pagamento.status) {
            await pool.query(
              'UPDATE pagamentos_pix SET status = $1, updated_at = NOW() WHERE id = $2',
              [statusAtualizado, pagamento.id]
            );
            
            // Se foi pago, confirmar agendamento
            if (statusAtualizado === 'pago' && pagamento.agendamento_status !== 'agendado') {
              await pool.query(
                'UPDATE agendamentos SET status = $1, data_pagamento = NOW() WHERE id = $2',
                ['agendado', agendamento_id]
              );
            }
            
            pagamento.status = statusAtualizado;
          }
        } else if (pagamento.tipo_pix === 'mercadopago') {
          const consultaMP = await mercadoPagoService.consultarPagamento(pagamento.payment_id_externo);
          statusAtualizado = mercadoPagoService.mapStatus(consultaMP.status);
          
          // Atualizar no banco se mudou
          if (statusAtualizado !== pagamento.status) {
            await pool.query(
              'UPDATE pagamentos_pix SET status = $1, updated_at = NOW() WHERE id = $2',
              [statusAtualizado, pagamento.id]
            );
            
            // Se foi pago, confirmar agendamento
            if (statusAtualizado === 'pago' && pagamento.agendamento_status !== 'agendado') {
              await pool.query(
                'UPDATE agendamentos SET status = $1, data_pagamento = NOW() WHERE id = $2',
                ['agendado', agendamento_id]
              );
            }
            
            pagamento.status = statusAtualizado;
          }
        }
      } catch (apiError) {
        console.error('❌ Erro ao consultar API de pagamento:', apiError);
        // Continuar com status local em caso de erro na API
      }
    }

    // Verificar se o PIX expirou (30 minutos)
    const agora = new Date();
    const criadoEm = new Date(pagamento.created_at);
    const tempoExpirado = (agora - criadoEm) > (30 * 60 * 1000);

    if (pagamento.status === 'pendente' && tempoExpirado) {
      // Marcar como expirado
      await pool.query(
        'UPDATE pagamentos_pix SET status = $1 WHERE id = $2',
        ['expirado', pagamento.id]
      );
      
      // Cancelar agendamento
      await pool.query(
        'UPDATE agendamentos SET status = $1 WHERE id = $2',
        ['cancelado', agendamento_id]
      );

      return res.json({
        success: false,
        status: 'expirado',
        message: 'PIX expirado. Faça um novo agendamento.',
        tempoRestante: 0
      });
    }

    // Calcular tempo restante
    const tempoRestante = Math.max(0, (30 * 60 * 1000) - (agora - criadoEm));

    res.json({
      success: true,
      status: pagamento.status,
      agendamento_status: pagamento.agendamento_status,
      valor: pagamento.valor,
      tipo_pix: pagamento.tipo_pix,
      tempoRestante: Math.floor(tempoRestante / 1000), // em segundos
      endToEndId: pagamento.end_to_end_id,
      dataPagamento: pagamento.data_pagamento
    });

  } catch (error) {
    console.error('❌ Erro ao verificar pagamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/webhook-asaas - Webhook oficial do Asaas
router.post('/webhook-asaas', async (req, res) => {
  try {
    console.log('🔔 Webhook Asaas recebido:', req.body);
    
    const { event, payment } = req.body;
    
    // Validar webhook (opcional)
    const signature = req.headers['asaas-signature'];
    const timestamp = req.headers['asaas-timestamp'];
    
    if (signature && !asaasService.validateWebhook(signature, req.body, timestamp)) {
      console.log('❌ Webhook Asaas inválido - assinatura não confere');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Processar eventos de pagamento
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      const paymentId = payment.id;
      const externalReference = payment.externalReference;
      
      console.log(`💰 Pagamento Asaas: ${event} - ID: ${paymentId} - Ref: ${externalReference}`);
      
      // Buscar pagamento no nosso banco
      const pagamentoLocal = await pool.query(
        'SELECT * FROM pagamentos_pix WHERE payment_id_externo = $1 OR external_reference = $2',
        [paymentId, externalReference]
      );

      if (pagamentoLocal.rows.length > 0) {
        const pixData = pagamentoLocal.rows[0];
        const novoStatus = asaasService.mapStatus(payment.status);
        
        console.log(`🔄 Atualizando status Asaas: ${pixData.status} → ${novoStatus}`);
        
        // Atualizar status do PIX
        await pool.query(
          `UPDATE pagamentos_pix 
           SET status = $1, end_to_end_id = $2, data_pagamento = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [novoStatus, payment.id, pixData.id]
        );

        // Se recebido/confirmado, confirmar agendamento
        if (novoStatus === 'pago') {
          await pool.query(
            'UPDATE agendamentos SET status = $1, data_pagamento = NOW() WHERE id = $2',
            ['agendado', pixData.agendamento_id]
          );
          
          console.log('✅ Agendamento confirmado automaticamente via webhook Asaas');
        }
      } else {
        console.log('⚠️ Pagamento Asaas não encontrado no banco local:', paymentId);
      }
    }

    res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('❌ Erro no webhook Asaas:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// POST /api/webhook-mercadopago - Webhook oficial do Mercado Pago
router.post('/webhook-mercadopago', async (req, res) => {
  try {
    console.log('🔔 Webhook Mercado Pago recebido:', req.body);
    
    const { type, data } = req.body;
    
    // Validar webhook (opcional, mas recomendado)
    const signature = req.headers['x-signature'];
    if (signature && !mercadoPagoService.validateWebhook(signature, req.body)) {
      console.log('❌ Webhook inválido - assinatura não confere');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Processar apenas notificações de pagamento
    if (type === 'payment') {
      const paymentId = data.id;
      
      // Consultar detalhes do pagamento na API do MP
      const pagamentoMP = await mercadoPagoService.consultarPagamento(paymentId);
      console.log('💳 Detalhes do pagamento MP:', pagamentoMP);
      
      // Buscar pagamento no nosso banco
      const pagamentoLocal = await pool.query(
        'SELECT * FROM pagamentos_pix WHERE payment_id_externo = $1 OR external_reference = $2',
        [paymentId, pagamentoMP.external_reference]
      );

      if (pagamentoLocal.rows.length > 0) {
        const pixData = pagamentoLocal.rows[0];
        const novoStatus = mercadoPagoService.mapStatus(pagamentoMP.status);
        
        console.log(`🔄 Atualizando status: ${pixData.status} → ${novoStatus}`);
        
        // Atualizar status do PIX
        await pool.query(
          `UPDATE pagamentos_pix 
           SET status = $1, end_to_end_id = $2, data_pagamento = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [novoStatus, pagamentoMP.id, pixData.id]
        );

        // Se aprovado, confirmar agendamento
        if (novoStatus === 'pago') {
          await pool.query(
            'UPDATE agendamentos SET status = $1, data_pagamento = NOW() WHERE id = $2',
            ['agendado', pixData.agendamento_id]
          );
          
          console.log('✅ Agendamento confirmado automaticamente via webhook MP');
        }
      } else {
        console.log('⚠️ Pagamento não encontrado no banco local:', paymentId);
      }
    }

    res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('❌ Erro no webhook Mercado Pago:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// POST /api/webhook-pix - Webhook para receber notificações de pagamento (simulado)
router.post('/webhook-pix', async (req, res) => {
  try {
    const { txid, endToEndId, valor, status } = req.body;

    console.log('🔔 Webhook PIX recebido:', req.body);

    if (status === 'PAID' || status === 'APPROVED') {
      // Buscar pagamento pelo pix_id
      const pagamento = await pool.query(
        'SELECT * FROM pagamentos_pix WHERE pix_id = $1 AND status = $2',
        [txid, 'pending']
      );

      if (pagamento.rows.length > 0) {
        const pixData = pagamento.rows[0];
        
        // Atualizar status do PIX
        await pool.query(
          'UPDATE pagamentos_pix SET status = $1, paid_at = NOW(), webhook_data = $2 WHERE id = $3',
          ['paid', JSON.stringify({endToEndId, data_confirmacao: new Date()}), pixData.id]
        );

        // Atualizar agendamento para confirmado
        await pool.query(
          'UPDATE agendamentos SET status = $1, data_pagamento = NOW() WHERE id = $2',
          ['agendado', pixData.agendamento_id]
        );

        console.log('✅ Pagamento automaticamente confirmado via webhook:', txid);
      }
    }

    res.json({ success: true, message: 'Webhook processado' });

  } catch (error) {
    console.error('❌ Erro no webhook PIX:', error);
    res.status(500).json({ success: false, message: 'Erro no webhook' });
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

    // VERIFICAÇÃO DETALHADA DE AGENDAMENTOS EXISTENTES COM DURAÇÃO
    const agendamentosExistentes = await pool.query(`
      SELECT a.horario, a.nome_cliente, a.id, a.status, s.duracao, s.nome_servico
      FROM agendamentos a
      JOIN servicos s ON a.servico_id = s.id
      WHERE a.data = $1 AND (a.status = 'agendado' OR a.status = 'confirmado')
      ORDER BY a.horario
    `, [data]);
    
    console.log('📋 Agendamentos existentes para', data + ':', agendamentosExistentes.rows.length);
    agendamentosExistentes.rows.forEach(agendamento => {
      console.log(`   - ${agendamento.horario}: ${agendamento.nome_cliente} (${agendamento.nome_servico} - ${agendamento.duracao}min, ID: ${agendamento.id}, Status: ${agendamento.status})`);
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

    // Extrair horários ocupados por agendamentos (considerando duração do serviço)
    const horariosOcupados = [];
    agendamentosExistentes.rows.forEach(agendamento => {
      const horarioInicio = agendamento.horario;
      const duracaoMinutos = parseInt(agendamento.duracao) || 30; // Default 30min se não especificado
      const duracaoSlot = parseInt(config.duracao_slot || '30');
      
      // Calcular quantos slots de duração_slot são necessários para a duração total
      const slotsNecessarios = Math.ceil(duracaoMinutos / duracaoSlot);
      
      console.log(`   - Processando agendamento ${horarioInicio}: ${agendamento.nome_servico} (${duracaoMinutos}min = ${slotsNecessarios} slots de ${duracaoSlot}min)`);
      
      // Adicionar todos os horários ocupados pela duração do serviço
      for (let i = 0; i < slotsNecessarios; i++) {
        const [hora, minuto] = horarioInicio.split(':').map(Number);
        const totalMinutos = hora * 60 + minuto + (i * duracaoSlot);
        const horaOcupada = Math.floor(totalMinutos / 60);
        const minutoOcupado = totalMinutos % 60;
        const horarioOcupado = `${horaOcupada.toString().padStart(2, '0')}:${minutoOcupado.toString().padStart(2, '0')}`;
        
        // Só adicionar se o horário estiver dentro dos horários base disponíveis
        if (horariosBase.includes(horarioOcupado)) {
          horariosOcupados.push(horarioOcupado);
          console.log(`     → Slot ${i + 1}: ${horarioOcupado} OCUPADO`);
        }
      }
    });
    
    console.log('🔴 TODOS os horários ocupados por agendamentos (com duração):', horariosOcupados);
    
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
    // Usar timezone do Brasil
    const brazilNow = getBrazilDateTime();
    const dataDefault = brazilNow.date;
    
    const data = req.params.data || dataDefault;
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
    
    // Usar timezone do Brasil
    const brazilNow = getBrazilDateTime();
    const dataDefault = brazilNow.date;
    
    const dataFilter = data || dataDefault;
    
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
      timestamp: getBrazilDateTime().fullDate.toISOString()
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