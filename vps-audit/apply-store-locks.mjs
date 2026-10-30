// One-time source transformation, kept as evidence of the audited fix.
import { readFileSync, writeFileSync } from 'node:fs';
const groups = {
 'server/src/usersStore-file.js': ['setUserRole','createUser','createStaffAccount','createResetToken','resetPassword','setPassword','deleteUser'],
 'server/src/store.js': ['saveScene','publishScene','unpublishScene','revertToPublished','restoreVersion','setSceneProperty','setEmbed','claimProperty','createProperty','renameProperty','deleteProperty','addPropertyMember','setPropertyTheme','setPropertyInfo','setLeadEmails','reassignProjects','removePropertyMember','setPropertyFeatures','setPropertyStatus']
};
for (const [file,names] of Object.entries(groups)) {
 let src=readFileSync(file,'utf8');
 if(src.includes("from './serial.js'")) continue;
 src="import { serialMutation } from './serial.js';\n"+src;
 for(const name of names){const old=`export async function ${name}(`;if(!src.includes(old))throw Error('Missing '+name);src=src.replace(old,`export const ${name} = serialMutation(${name}Impl);\nasync function ${name}Impl(`);}
 writeFileSync(file,src);
}
