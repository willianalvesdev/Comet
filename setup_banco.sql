CREATE TABLE IF NOT EXISTS usuarios (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NOT NULL,
    expira_em DATETIME NOT NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX sessoes_expiracao (expira_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS computer_conversas (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NOT NULL,
    titulo VARCHAR(100) NOT NULL,
    criado_em DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    atualizado_em DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    requisicao_ativa CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ativa_ate DATETIME(6) NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX computer_conversas_usuario (usuario_id, atualizado_em, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS computer_mensagens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversa_id BIGINT UNSIGNED NOT NULL,
    requisicao_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    pergunta TEXT NOT NULL,
    resposta MEDIUMTEXT NOT NULL,
    pensamento MEDIUMTEXT NOT NULL,
    estado ENUM('running', 'completed', 'interrupted', 'failed') NOT NULL,
    criado_em DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    atualizado_em DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (conversa_id) REFERENCES computer_conversas(id) ON DELETE CASCADE,
    INDEX computer_mensagens_conversa (conversa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS computer_personalizacao (
    usuario_id BIGINT UNSIGNED PRIMARY KEY,
    nome_preferido VARCHAR(100) NOT NULL DEFAULT '',
    ocupacao VARCHAR(200) NOT NULL DEFAULT '',
    sobre TEXT NOT NULL,
    memoria_ativa BOOLEAN NOT NULL DEFAULT TRUE,
    resumo TEXT NOT NULL,
    versao BIGINT UNSIGNED NOT NULL DEFAULT 0,
    atualizado_em DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NOT NULL,
    external_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    kind ENUM('income','expense') NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    description VARCHAR(200) NOT NULL,
    category VARCHAR(80) NOT NULL DEFAULT '',
    occurred_on DATE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY finance_external (usuario_id, external_id),
    deleted_at DATETIME(6) NULL DEFAULT NULL,
    INDEX finance_history (usuario_id, occurred_on, id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_operations (
    usuario_id BIGINT UNSIGNED NOT NULL,
    operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii NOT NULL,
    result JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, operation_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_transaction_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NOT NULL,
    operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    transaction_id BIGINT UNSIGNED NOT NULL,
    event ENUM('TRANSACTION_CREATED', 'TRANSACTION_UPDATED', 'TRANSACTION_DELETED',
               'TRANSACTION_RESTORED', 'TRANSACTION_PERMANENTLY_DELETED') NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    before_json JSON NULL,
    after_json JSON NULL,
    INDEX finance_event_history (usuario_id, transaction_id, id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
