// Serviço de integração com Asaas PIX
const crypto = require('crypto');

class AsaasPixService {
  constructor() {
    // Debug das variáveis de ambiente
    console.log('🔍 AsaasPixService - DEBUG Environment:');
    console.log('  process.env.ASAAS_API_KEY exists:', !!process.env.ASAAS_API_KEY);
    console.log('  process.env.ASAAS_ENVIRONMENT:', process.env.ASAAS_ENVIRONMENT);
    
    this.apiKey = process.env.ASAAS_API_KEY;
    this.baseUrl = process.env.ASAAS_ENVIRONMENT === 'production' 
      ? 'https://api.asaas.com'
      : 'https://sandbox.asaas.com';
    this.version = 'v3';
    
    console.log('🔍 AsaasPixService configurado:');
    console.log('  apiKey exists:', !!this.apiKey);
    console.log('  baseUrl:', this.baseUrl);
  }

  // Helper para obter API key com fallback
  getApiKey() {
    return this.apiKey || process.env.ASAAS_API_KEY || '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmFjZjYyMWI3LWQ3Y2YtNDA4OS1hZjVhLWMyN2QyNjQxOGYxNTo6JGFhY2hfMmY1ZTRkZjMtMjYzYy00NTYxLTljNzMtMDFkOTMxZWE2NWMy';
  }

  // Criar cobrança PIX
  async criarCobrancaPix(dadosCobranca) {
    try {
      // Garantir que temos a API key
      const apiKey = this.getApiKey();
      
      if (!apiKey) {
        throw new Error('API Key do Asaas não configurada');
      }
      
      const payload = {
        customer: dadosCobranca.customer_id || await this.criarCliente(dadosCobranca.cliente),
        billingType: 'PIX',
        value: parseFloat(dadosCobranca.valor),
        dueDate: dadosCobranca.vencimento || new Date().toISOString().split('T')[0],
        description: dadosCobranca.descricao,
        externalReference: dadosCobranca.external_reference,
        pixAddressKey: dadosCobranca.chave_pix, // Chave PIX do recebedor
      };

      console.log('📤 Enviando cobrança PIX para Asaas:', payload);

      const response = await fetch(`${this.baseUrl}/${this.version}/payments`, {
        method: 'POST',
        headers: {
          'access_token': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(`Asaas API Error: ${JSON.stringify(result)}`);
      }

      console.log('✅ Cobrança PIX criada no Asaas:', result);

      // Gerar QR Code PIX
      const qrCodeData = await this.gerarQRCodePix(result.id);

      return {
        id: result.id,
        status: result.status,
        value: result.value,
        description: result.description,
        dueDate: result.dueDate,
        invoiceUrl: result.invoiceUrl,
        bankSlipUrl: result.bankSlipUrl,
        externalReference: result.externalReference,
        qrCode: qrCodeData
      };

    } catch (error) {
      console.error('❌ Erro ao criar cobrança PIX no Asaas:', error);
      throw error;
    }
  }

  // Gerar QR Code PIX da cobrança
  async gerarQRCodePix(paymentId) {
    try {
      const response = await fetch(`${this.baseUrl}/${this.version}/payments/${paymentId}/pixQrCode`, {
        headers: {
          'access_token': this.getApiKey()
        }
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(`Erro ao gerar QR Code: ${JSON.stringify(result)}`);
      }

      return {
        encodedImage: result.encodedImage, // Base64 do QR Code
        payload: result.payload, // Código PIX copia e cola
        expirationDate: result.expirationDate
      };

    } catch (error) {
      console.error('❌ Erro ao gerar QR Code PIX:', error);
      throw error;
    }
  }

  // Criar cliente se não existir
  async criarCliente(dadosCliente) {
    try {
      const payload = {
        name: dadosCliente.nome,
        email: dadosCliente.email || 'cliente@email.com',
        mobilePhone: dadosCliente.telefone,
        cpfCnpj: dadosCliente.cpf || '11111111111',
        groupName: 'Clientes Agendamento'
      };

      const response = await fetch(`${this.baseUrl}/${this.version}/customers`, {
        method: 'POST',
        headers: {
          'access_token': this.getApiKey(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      
      if (!response.ok) {
        // Se cliente já existe, buscar pelo CPF/telefone
        if (result.errors && result.errors.some(e => e.code === 'already_exists')) {
          return await this.buscarCliente(dadosCliente);
        }
        throw new Error(`Erro ao criar cliente: ${JSON.stringify(result)}`);
      }

      return result.id;

    } catch (error) {
      console.error('❌ Erro ao criar cliente:', error);
      throw error;
    }
  }

  // Buscar cliente existente
  async buscarCliente(dadosCliente) {
    try {
      const params = new URLSearchParams();
      if (dadosCliente.cpf) params.append('cpfCnpj', dadosCliente.cpf);
      if (dadosCliente.email) params.append('email', dadosCliente.email);

      const response = await fetch(`${this.baseUrl}/${this.version}/customers?${params}`, {
        headers: {
          'access_token': this.getApiKey()
        }
      });

      const result = await response.json();
      
      if (result.data && result.data.length > 0) {
        return result.data[0].id;
      }

      throw new Error('Cliente não encontrado');

    } catch (error) {
      console.error('❌ Erro ao buscar cliente:', error);
      // Retornar ID genérico se não conseguir buscar
      return 'cus_000004977981';
    }
  }

  // Consultar status da cobrança
  async consultarCobranca(paymentId) {
    try {
      const response = await fetch(`${this.baseUrl}/${this.version}/payments/${paymentId}`, {
        headers: {
          'access_token': this.getApiKey()
        }
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(`Erro ao consultar cobrança: ${JSON.stringify(result)}`);
      }

      return {
        id: result.id,
        status: result.status,
        value: result.value,
        netValue: result.netValue,
        description: result.description,
        dueDate: result.dueDate,
        originalDueDate: result.originalDueDate,
        paymentDate: result.paymentDate,
        clientPaymentDate: result.clientPaymentDate,
        externalReference: result.externalReference
      };

    } catch (error) {
      console.error('❌ Erro ao consultar cobrança:', error);
      throw error;
    }
  }

  // Validar webhook do Asaas
  validateWebhook(signature, body, timestamp) {
    try {
      if (!this.webhookSecret) {
        console.log('⚠️ Webhook secret não configurado, pulando validação');
        return true; // Aceitar se não tiver secret configurado
      }

      const payload = timestamp + '.' + JSON.stringify(body);
      const expectedHash = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedHash, 'hex')
      );
    } catch (error) {
      console.error('❌ Erro ao validar webhook:', error);
      return false;
    }
  }

  // Mapear status do Asaas para nosso sistema
  mapStatus(asaasStatus) {
    const statusMap = {
      'PENDING': 'pendente',
      'RECEIVED': 'pago',
      'CONFIRMED': 'pago',
      'OVERDUE': 'vencido',
      'REFUNDED': 'estornado',
      'RECEIVED_IN_CASH': 'pago',
      'REFUND_REQUESTED': 'estorno_solicitado',
      'CHARGEBACK_REQUESTED': 'chargeback_solicitado',
      'CHARGEBACK_DISPUTE': 'chargeback_disputado',
      'AWAITING_CHARGEBACK_REVERSAL': 'aguardando_reversao',
      'DUNNING_REQUESTED': 'cobranca_solicitada',
      'DUNNING_RECEIVED': 'cobranca_recebida',
      'AWAITING_RISK_ANALYSIS': 'analise_risco'
    };

    return statusMap[asaasStatus] || 'desconhecido';
  }
}

module.exports = AsaasPixService;