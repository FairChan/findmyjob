// 关联搜索用的同义词组：搜组里任何一个词，都会顺带找组里其他词（PRD v0.2 §2.4）
// 正式版放进 SearchSynonymGroup 表，运营可以在后台改；这里是同一份默认数据
export const SYNONYM_GROUPS: string[][] = [
  ['财务', '会计', '审计', '出纳', '税务', '金融', 'finance', 'accounting', 'audit'],
  ['管理', '管培生', '管理培训生', 'management', 'mt'],
  ['前端', '前端开发', 'web', 'react', 'vue', 'frontend'],
  ['后端', '后端开发', '服务端', 'java', 'backend'],
  ['数据', '数据分析', '数据科学', 'sql', 'python', 'bi', 'data'],
  ['算法', '算法工程师', '机器学习', '人工智能', '大模型', 'ai', 'llm'],
  ['电商', '跨境电商', '跨境电商运营', 'shopee', 'lazada', 'tiktok shop', 'ecommerce'],
  ['新媒体', '新媒体运营', '小红书', '直播', '内容运营', 'tiktok', 'social media'],
  ['翻译', '中马翻译', '中英翻译', '口译', '笔译', 'translator'],
  ['土木', '土木工程师', '结构', '施工', '工程管理', 'civil'],
  ['电气', '电气工程师', '电力', 'plc', 'electrical'],
  ['机械', '机械工程师', 'solidworks', 'mechanical'],
  ['物流', '供应链', '报关', '采购', '国际贸易', 'logistics', 'supply chain'],
  ['行政', '行政助理', '人力资源', '招聘', 'hr', 'admin'],
  ['教育', '助教', '中文教师', '课程顾问', 'teacher'],
  ['销售', '客户经理', '销售代表', 'sales'],
  ['产品', '产品经理', '产品助理', 'product manager', 'pm'],
]
