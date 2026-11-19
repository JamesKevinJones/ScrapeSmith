import type { ExtractionMode, FieldDefinition } from '../types';

export interface ExtractionPreset {
  id: string;
  label: string;
  urlsText: string;
  fieldsText: string;
  mode: ExtractionMode;
  fields: FieldDefinition[];
}

export const EXTRACTION_PRESETS: ExtractionPreset[] = [
  {
    id: 'books-catalog',
    label: 'Bookstore Catalog',
    urlsText: 'https://books.toscrape.com/catalogue/category/books/science_22/index.html',
    fieldsText: 'title, price, rating, availability, product_url',
    mode: 'list',
    fields: [
      { id: 'field_title', name: 'title', type: 'string', description: 'Book title' },
      { id: 'field_price', name: 'price', type: 'number', description: 'Book price as number' },
      { id: 'field_rating', name: 'rating', type: 'string', description: 'Star rating label' },
      { id: 'field_availability', name: 'availability', type: 'string', description: 'Stock status' },
      { id: 'field_product_url', name: 'product_url', type: 'url', description: 'Link to book page' },
    ],
  },
  {
    id: 'framework-releases',
    label: 'Open Source Docs',
    urlsText: 'https://react.dev/versions\nhttps://vite.dev/guide/',
    fieldsText: 'project_name, latest_version, release_date, key_features, docs_url',
    mode: 'single',
    fields: [
      { id: 'field_project_name', name: 'project_name', type: 'string', description: 'Project name' },
      { id: 'field_latest_version', name: 'latest_version', type: 'string', description: 'Current stable version' },
      { id: 'field_release_date', name: 'release_date', type: 'date', description: 'Release date (ISO 8601)' },
      { id: 'field_key_features', name: 'key_features', type: 'list', description: 'Highlighted features' },
      { id: 'field_docs_url', name: 'docs_url', type: 'url', description: 'Documentation link' },
    ],
  },
  {
    id: 'topic-discovery',
    label: 'Topic Search Mode',
    urlsText: 'Top open-weight coding LLMs benchmark comparison 2026',
    fieldsText: 'model_name, organization, parameter_count, license, release_date',
    mode: 'list',
    fields: [
      { id: 'field_model_name', name: 'model_name', type: 'string', description: 'Model name' },
      { id: 'field_organization', name: 'organization', type: 'string', description: 'Creator organization' },
      { id: 'field_parameter_count', name: 'parameter_count', type: 'string', description: 'Parameter size' },
      { id: 'field_license', name: 'license', type: 'string', description: 'Software license' },
      { id: 'field_release_date', name: 'release_date', type: 'date', description: 'Release date' },
    ],
  },
];
