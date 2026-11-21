import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { createReviewHandler } from '../server/reviews.ts';
import type { ApiRequest } from '../server/availability.ts';
import type { PublicReview, ReviewRecord } from '../shared/reviews.ts';
import { reviewHeaders, reviewResponse, reviewStorage } from './review-fixtures.ts';

const record = { name:'Example guest', text:'Lovely stay.', notes:'Private audit note', source:'Direct', date:'',
  rating:null, scale:5, featured:false, url:'', alt:'', cropX:50, cropY:50 };

function setup() {
  const { options, values } = reviewStorage();
  const admin = createReviewHandler(true,options);
  const publicReviews = createReviewHandler(false,options);
  const call = async (handler: typeof admin, req: Partial<ApiRequest> = {}) => {
    const res = reviewResponse();
    await handler({ method:'GET', headers:{}, ...req }, res);
    return res;
  };
  return { values, admin, publicReviews, call,
    save: (body: unknown) => call(admin,{method:'POST',headers:reviewHeaders,body}),
    list: async () => (await call(publicReviews)).body as {reviews:PublicReview[]},
  };
}
const adminList = (body: unknown) => (body as {reviews:ReviewRecord[]}).reviews;

test('The existing Airbnb review is manageable and only published fields are exposed', async () => {
  const { admin, publicReviews, call, save, list } = setup();
  assert.equal((await call(admin)).code,401);
  const seed = adminList((await call(admin,{headers:reviewHeaders})).body)[0];
  assert.equal(seed.name,'Nikki');
  assert.equal((await list()).reviews[0].name,'Nikki');
  assert.equal((await call(publicReviews,{method:'POST',headers:reviewHeaders})).code,405);
  assert.equal((await call(admin,{method:'POST',headers:{...reviewHeaders,origin:'https://other.invalid'}})).code,401);
  const hidden = await save({action:'status',id:seed.id,revision:seed.revision,status:'Hidden'});
  assert.equal(hidden.code,200);
  assert.deepEqual((await list()).reviews,[]);
  assert.equal(adminList(hidden.body)[0].text,seed.text);
});

test('Draft, publish, edit, feature, reorder, archive and restore preserve review history', async () => {
  const { save,list } = setup();
  const id = randomUUID();
  const create = {action:'create',id,record,status:'Draft'};
  const draft = await save(create);
  assert.equal(draft.code,200);
  assert.equal((await list()).reviews.length,1);
  const saved = adminList(draft.body).find(item=>item.id===id)!;
  assert.equal((await save(create)).code,200);
  assert.equal(adminList((await save(create)).body).length,2);
  const patch = {action:'save',id,revision:saved.revision,status:'Published',record:{...record,featured:true}};
  assert.equal((await save(patch)).code,400);
  assert.equal((await save({...patch,approved:true,record:{...patch.record,text:'Contact me at private@example.invalid.'}})).code,400);
  const published = await save({...patch,approved:true});
  assert.equal(published.code,200);
  const live = (await list()).reviews[0];
  assert.equal(live.id,id);
  assert.equal(live.rating,null);
  for (const field of ['notes','status','revision','approved']) assert.ok(!(field in live));
  assert.equal((await save({...patch,approved:true})).code,409);
  const edit = await save({...patch,approved:true,revision:adminList(published.body)[0].revision,record:{...record,text:'Same stay, updated excerpt.'}});
  assert.equal(edit.code,200);
  const edited = adminList(edit.body).find(item=>item.id===id)!;
  assert.equal((await list()).reviews.at(-1)?.text,'Same stay, updated excerpt.');
  const moved = await save({action:'move',id,revision:edited.revision,direction:-1});
  assert.equal((await list()).reviews[0].id,id);
  const archived = await save({action:'status',id,revision:adminList(moved.body)[0].revision,status:'Archived'});
  assert.ok(!(await list()).reviews.some(item=>item.id===id));
  const stored = adminList(archived.body).find(item=>item.id===id)!;
  assert.equal(stored.notes,record.notes);
  assert.equal(stored.status,'Archived');
  const restored = await save({action:'status',id,revision:stored.revision,status:'Draft'});
  assert.equal(adminList(restored.body).find(item=>item.id===id)?.status,'Draft');
  assert.ok(!(await list()).reviews.some(item=>item.id===id));
});

test('Photo-only and combined reviews retain private originals and serve redacted display images only while published', async () => {
  const { save,list,call,admin,publicReviews,values } = setup();
  const id = randomUUID();
  const bytes = await sharp({create:{width:1024,height:512,channels:3,background:'#ffe420'}}).png().toBuffer();
  const request = {action:'create',id,status:'Published',approved:true,record:{...record,text:'',alt:'Guest review screenshot'},
    image:{data:bytes.toString('base64'),redactions:[{x:0,y:0,width:.3,height:.5}]}};
  assert.equal((await save({...request,image:{...request.image,data:Buffer.from('<svg></svg>').toString('base64')}})).code,400);
  const published = await save(request);
  assert.equal(published.code,200);
  const uploaded = adminList(published.body).find(item=>item.id===id)!;
  const live = (await list()).reviews.find(item=>item.id===id)!;
  assert.ok(live.photo && !('redactions' in live.photo));
  assert.equal(live.text,'');
  const query = {reviewImage:id,asset:uploaded.photo!.id};
  assert.equal((await call(publicReviews,{query:{...query,size:'original'}})).code,404);
  const original = await call(admin,{headers:reviewHeaders,query:{...query,size:'original'}});
  assert.equal((original.body as {data:string}).data,bytes.toString('base64'));
  assert.ok([...values.entries()].filter(([name])=>name.endsWith(':original')).every(([,value])=>value !== bytes.toString('base64')));
  const full = await call(publicReviews,{query:{...query,size:'full'}});
  assert.equal(full.headers['Cache-Control'],'no-store');
  assert.equal(full.headers['Content-Type'],'image/webp');
  const metadata = await sharp(full.body as Buffer).metadata();
  assert.equal(metadata.width,1024);
  assert.equal(metadata.height,512);
  const sample = await sharp(full.body as Buffer).extract({left:40,top:40,width:1,height:1}).raw().toBuffer();
  assert.ok([...sample].every(n=>n<30));
  const thumb = await call(publicReviews,{query:{...query,size:'thumb'}});
  assert.equal((await sharp(thumb.body as Buffer).metadata()).width,720);
  const combined = await save({action:'save',id,revision:uploaded.revision,status:'Published',approved:true,
    record:{...request.record,text:'Written feedback as well.',cropY:0}});
  assert.equal(combined.code,200);
  const edited = adminList(combined.body).find(item=>item.id===id)!;
  assert.equal((await list()).reviews.find(item=>item.id===id)?.cropY,0);
  const hidden = await save({action:'status',id,revision:edited.revision,status:'Hidden'});
  assert.equal(hidden.code,200);
  assert.equal((await call(publicReviews,{query:{...query,size:'full'}})).code,404);
  assert.equal((await call(admin,{headers:reviewHeaders,query:{...query,size:'original'}})).code,200);
  const replacement = await save({
    action:'save', id, revision:adminList(hidden.body).find(item=>item.id===id)!.revision, status:'Published', approved:true,
    record:{...request.record,source:'Other',sourceName:'Host guestbook'}, image:{...request.image,redactions:[]},
  });
  assert.equal(replacement.code,200);
  assert.equal((await list()).reviews.find(item=>item.id===id)?.sourceName,'Host guestbook');
  assert.equal((await call(publicReviews,{query:{...query,size:'full'}})).code,404);
  const prior = await call(admin,{headers:reviewHeaders,query:{...query,size:'original'}});
  assert.equal((prior.body as {data:string}).data,bytes.toString('base64'));
});
