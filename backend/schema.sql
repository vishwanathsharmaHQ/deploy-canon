-- Create threads table
CREATE TABLE threads (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_on_chain BOOLEAN DEFAULT FALSE,
    chain_id INTEGER,
    metadata JSONB
);

-- Create nodes table
CREATE TABLE nodes (
    id SERIAL PRIMARY KEY,
    thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    node_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_on_chain BOOLEAN DEFAULT FALSE,
    chain_id INTEGER,
    metadata JSONB,
    parent_id INTEGER REFERENCES nodes(id)
);

-- Create edges table for node relationships
CREATE TABLE edges (
    id SERIAL PRIMARY KEY,
    source_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
    target_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB,
    UNIQUE(source_id, target_id)
);

-- Create index for faster querying
CREATE INDEX idx_thread_nodes ON nodes(thread_id);
CREATE INDEX idx_edge_source ON edges(source_id);
CREATE INDEX idx_edge_target ON edges(target_id); 