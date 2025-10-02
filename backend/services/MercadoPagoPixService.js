// Serviço de integração com Mercado Pago PIX
const crypto = require('crypto');

class MercadoPagoPixService {
  constructor() {
    this.accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    this.baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://api.mercadopago.com'
      : 'https://api.mercadopago.com'; // Mesmo endpoint para sandbox/prod
    this.webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  }

  // Criar pagamento PIX
  async criarPagamentoPix(dadosPagamento) {
    try {
      const payload = {
        transaction_amount: parseFloat(dadosPagamento.valor),
        description: dadosPagamento.descricao,
        payment_method_id: 'pix',
        external_reference: dadosPagamento.external_reference,
        notification_url: `${process.env.BASE_URL}/api/webhook-mercadopago`,
        payer: {
          first_name: dadosPagamento.pagador.nome,
          last_name: dadosPagamento.pagador.sobrenome || '',
          email: dadosPagamento.pagador.email || 'cliente@email.com',
          identification: {
            type: 'CPF',
            number: dadosPagamento.pagador.cpf || '11111111111'
          }
        },
        metadata: {
          agendamento_id: dadosPagamento.agendamento_id
        }
      };

      const response = await fetch(`${this.baseUrl}/v1/payments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(`Mercado Pago API Error: ${JSON.stringify(result)}`);
      }

      return {
        id: result.id,
        status: result.status,
        qr_code: result.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: result.point_of_interaction?.transaction_data?.qr_code_base64,
        ticket_url: result.point_of_interaction?.transaction_data?.ticket_url,
        external_reference: result.external_reference,
        date_of_expiration: result.date_of_expiration
      };

    } catch (error) {
      console.error('❌ Erro ao criar pagamento PIX:', error);
      throw error;
    }
  }

  // Consultar status do pagamento
  async consultarPagamento(paymentId) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(`Erro ao consultar pagamento: ${JSON.stringify(result)}`);
      }

      return {
        id: result.id,
        status: result.status,
        status_detail: result.status_detail,
        external_reference: result.external_reference,
        transaction_amount: result.transaction_amount,
        date_approved: result.date_approved,
        date_created: result.date_created
      };

    } catch (error) {
      console.error('❌ Erro ao consultar pagamento:', error);
      throw error;
    }
  }

  // Validar webhook
  validateWebhook(signature, body) {
    try {
      const parts = signature.split(',');
      const ts = parts.find(part => part.startsWith('ts='))?.split('=')[1];
      const hash = parts.find(part => part.startsWith('v1='))?.split('=')[1];

      if (!ts || !hash) {
        return false;
      }

      const payload = ts + '.' + JSON.stringify(body);
      const expectedHash = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(expectedHash, 'hex')
      );
    } catch (error) {
      console.error('❌ Erro ao validar webhook:', error);
      return false;
    }
  }

  // Mapear status do Mercado Pago para nosso sistema
  mapStatus(mpStatus) {
    const statusMap = {
      'pending': 'pendente',
      'approved': 'pago',
      'authorized': 'pago',
      'in_process': 'processando',
      'in_mediation': 'disputado',
      'rejected': 'rejeitado',
      'cancelled': 'cancelado',
      'refunded': 'estornado',
      'charged_back': 'chargeback'
    };

    return statusMap[mpStatus] || 'desconhecido';
  }
}

module.exports = MercadoPagoPixService;